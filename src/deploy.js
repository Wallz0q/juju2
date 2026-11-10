/**
 * Engine deploy Railway — stabil (retry, error jelas, validasi token)
 */
const axios = require('axios');

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';
const DEFAULT_REPO = process.env.RAILWAY_REPO || 'parham7991/railway-ubuntu-ssh-claude';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function railwayGraphQL(token, query, variables = {}, retries = 3) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.post(RAILWAY_API, { query, variables }, { headers, timeout: 30000 });
      if (res.data.errors?.length) {
        const msg = res.data.errors.map((e) => e.message).join(' | ');
        if (/unauthorized|forbidden|invalid token|not authenticated/i.test(msg)) {
          throw new Error(`Auth gagal: ${msg}`);
        }
        throw new Error(msg);
      }
      return res.data.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const body = err.response?.data;
      const detail =
        body?.errors?.map((e) => e.message).join(' | ') ||
        (typeof body === 'object' ? JSON.stringify(body) : body) ||
        err.message;
      if (status === 401 || status === 403) throw new Error(`Token Railway ditolak (${status}): ${detail}`);
      if (status === 429 || (status >= 500 && status < 600) || err.code === 'ECONNRESET') {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw new Error(detail || err.message);
    }
  }
  throw lastError;
}

async function validateToken(token) {
  const data = await railwayGraphQL(
    token,
    `query { me { id email workspaces { edges { node { id name } } } } }`
  );
  if (!data?.me) throw new Error('Token Railway tidak valid.');
  const workspaces = data.me.workspaces?.edges || [];
  if (!workspaces.length) throw new Error('Akun tidak punya workspace. Buat project manual di railway.app dulu.');
  return {
    userId: data.me.id,
    email: data.me.email,
    workspaceId: workspaces[0].node.id,
    workspaceName: workspaces[0].node.name,
  };
}

async function createProject(token, name, workspaceId) {
  const data = await railwayGraphQL(
    token,
    `mutation($name: String!, $workspaceId: String) {
      projectCreate(input: { name: $name, workspaceId: $workspaceId }) {
        id name
        environments(first: 1) { edges { node { id } } }
      }
    }`,
    { name, workspaceId }
  );
  const project = data.projectCreate;
  if (!project?.id) throw new Error('Gagal membuat project.');
  const envId = project.environments?.edges?.[0]?.node?.id;
  if (!envId) throw new Error('Environment tidak ditemukan.');
  return { projectId: project.id, envId };
}

async function createService(token, projectId, name, repo) {
  const data = await railwayGraphQL(
    token,
    `mutation($projectId: String!, $name: String!, $repo: String!) {
      serviceCreate(input: { projectId: $projectId, name: $name, source: { repo: $repo } }) { id }
    }`,
    { projectId, name, repo }
  );
  if (!data.serviceCreate?.id) {
    throw new Error(`Gagal create service. Repo "${repo}" mungkin private/dihapus.`);
  }
  return data.serviceCreate.id;
}

async function setVariables(token, projectId, envId, serviceId, variables) {
  await railwayGraphQL(
    token,
    `mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $variables: EnvironmentVariables!) {
      variableCollectionUpsert(input: {
        projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, variables: $variables
      })
    }`,
    { projectId, environmentId: envId, serviceId, variables }
  );
}

async function createTcpProxy(token, envId, serviceId, appPort = 22) {
  const data = await railwayGraphQL(
    token,
    `mutation($environmentId: String!, $serviceId: String!, $applicationPort: Int!) {
      tcpProxyCreate(input: {
        environmentId: $environmentId, serviceId: $serviceId, applicationPort: $applicationPort
      }) { domain proxyPort }
    }`,
    { environmentId: envId, serviceId, applicationPort: appPort }
  );
  if (!data.tcpProxyCreate?.domain) throw new Error('Gagal TCP proxy. Cek kuota/plan akun Railway.');
  return { domain: data.tcpProxyCreate.domain, port: data.tcpProxyCreate.proxyPort };
}

async function getLatestDeployStatus(token, projectId, envId, serviceId) {
  const data = await railwayGraphQL(
    token,
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      deployments(first: 1, input: {
        projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId
      }) { edges { node { status } } }
    }`,
    { projectId, environmentId: envId, serviceId }
  );
  return data.deployments?.edges?.[0]?.node?.status || 'NONE';
}

async function waitForDeploy(token, projectId, envId, serviceId, onStatus) {
  const maxWait = 15 * 60 * 1000;
  const start = Date.now();
  let last = 'PENDING';
  while (Date.now() - start < maxWait) {
    try {
      last = (await getLatestDeployStatus(token, projectId, envId, serviceId)) || last;
      if (onStatus) onStatus(last);
      if (last === 'SUCCESS') return { ok: true, status: last };
      if (['FAILED', 'CRASHED', 'REMOVED'].includes(last)) {
        return { ok: false, status: last, message: `Deploy ${last}. Cek logs di dashboard Railway.` };
      }
    } catch (e) {
      if (onStatus) onStatus(`POLL: ${e.message}`);
    }
    await sleep(5000);
  }
  return { ok: false, status: last, message: `Timeout. Status terakhir: ${last}` };
}

function randomPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let pw = 'Vps';
  for (let i = 0; i < 10; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
  return pw + '#!';
}

/**
 * @param {string} token Railway token
 * @param {string} vpsName
 * @param {{ onProgress?: Function, repo?: string }} opts
 */
async function deployVPS(token, vpsName, opts = {}) {
  const repo = opts.repo || DEFAULT_REPO;
  const onProgress = opts.onProgress || (() => {});

  token = String(token || '').trim();
  if (!token) throw new Error('Token Railway kosong.');

  vpsName = String(vpsName || '').trim().replace(/\s+/g, '-');
  if (!/^[a-zA-Z0-9-]+$/.test(vpsName) || vpsName.length < 2) {
    throw new Error('Nama VPS hanya huruf, angka, dan -');
  }

  const password = randomPassword();

  onProgress(1, 'Validasi token Railway...');
  const account = await validateToken(token);

  onProgress(2, `Buat project "${vpsName}"...`);
  const { projectId, envId } = await createProject(token, vpsName, account.workspaceId);

  onProgress(3, 'Create service dari template...');
  const serviceId = await createService(token, projectId, vpsName, repo);

  onProgress(4, 'Set password root...');
  try {
    await setVariables(token, projectId, envId, serviceId, { ROOT_PASSWORD: password });
  } catch (_) {}

  onProgress(5, 'Buka TCP proxy SSH...');
  const proxy = await createTcpProxy(token, envId, serviceId, 22);

  onProgress(6, 'Menunggu build (bisa 2–15 menit)...');
  const result = await waitForDeploy(token, projectId, envId, serviceId, (st) =>
    onProgress(6, `Status deploy: ${st}`)
  );
  if (!result.ok) throw new Error(result.message);

  return {
    ok: true,
    projectId,
    serviceId,
    name: vpsName,
    ssh: {
      host: proxy.domain,
      port: proxy.port,
      username: 'root',
      password,
    },
  };
}

async function fetchProjects(token) {
  const data = await railwayGraphQL(
    token,
    `query { me { workspaces { edges { node { projects { edges { node { id name } } } } } } } }`
  );
  const list = [];
  for (const ws of data.me?.workspaces?.edges || []) {
    for (const p of ws.node.projects?.edges || []) {
      list.push({ id: p.node.id, name: p.node.name });
    }
  }
  return list;
}

module.exports = { deployVPS, validateToken, fetchProjects, randomPassword };
