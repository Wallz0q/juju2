/**
 * IWAW VPS Bot v2 — sama alur script awal, deploy engine di-upgrade
 */
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { deployVPS, fetchProjects } = require('./src/deploy');

// ========== CONFIG ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID || 0);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN belum di-set. Isi file .env');
  process.exit(1);
}
if (!OWNER_ID) {
  console.warn('WARNING: OWNER_ID belum di-set di .env');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== UI helpers (gaya IWAW) ==========
const DIVIDER = '───────────◆───────────';
const BRAND = '𝗜𝗪𝗔𝗪';
const TAGLINE = '𝘝𝘗𝘚 𝙎𝙮𝙨𝙩𝙚𝙢';

function card(title, body, footer) {
  let inner = `${BRAND}  <i>${TAGLINE}</i>\n${DIVIDER}\n<b>${title}</b>\n\n${body || ''}`;
  if (footer) inner += `\n\n${DIVIDER}\n➤ <i>${footer}</i>`;
  return `<blockquote>${inner}</blockquote>`;
}
function cardOk(t, b, f) { return card(`🟢 ${t}`, b, f); }
function cardErr(t, b, f) { return card(`🔴 ${t}`, b, f); }
function cardWarn(t, b, f) { return card(`🟡 ${t}`, b, f); }

function escapeHtml(t) {
  return String(t || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mention(user) {
  if (!user) return 'User';
  return user.username ? `@${user.username}` : escapeHtml(user.first_name || 'User');
}

function isOwner(msg) {
  return Number(msg.from?.id) === OWNER_ID;
}

const cancelKeyboard = {
  inline_keyboard: [[{ text: '𝐁𝐚𝐭𝐚𝐥𝐤𝐚𝐧', callback_data: 'cancel' }]],
};

const homeKeyboard = {
  inline_keyboard: [
    [
      { text: '𝐂𝐫𝐞𝐚𝐭𝐞 𝐕𝐏𝐒', callback_data: 'createvps' },
      { text: '𝐓𝐨𝐤𝐞𝐧 𝐒𝐚𝐲𝐚', callback_data: 'mytoken' },
    ],
    [
      { text: '𝐒𝐞𝐭 𝐓𝐨𝐤𝐞𝐧', callback_data: 'settoken' },
      { text: '𝐋𝐢𝐬𝐭 𝐏𝐫𝐨𝐣𝐞𝐜𝐭', callback_data: 'listproj' },
    ],
    [{ text: '𝐓𝐮𝐭𝐮𝐩', callback_data: 'close' }],
  ],
};

// ========== TOKEN FILE ==========
const TOKENS_FILE = 'tokens.json';
let tokens = {};

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch {
    tokens = {};
  }
}
function saveTokens() {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}
loadTokens();

function userTokenKey(userId) {
  return `user_${userId}`;
}
function getUserToken(userId) {
  const t = tokens[userTokenKey(userId)];
  return t?.token || null;
}
function setUserToken(userId, token) {
  tokens[userTokenKey(userId)] = {
    token: String(token).trim(),
    ownerId: String(userId),
  };
  saveTokens();
}

// ========== SESSIONS ==========
const sessions = new Map();

function setSession(chatId, data) {
  sessions.set(String(chatId), { ...data, at: Date.now() });
}
function getSession(chatId) {
  return sessions.get(String(chatId));
}
function clearSession(chatId) {
  sessions.delete(String(chatId));
}

// ========== COMMANDS ==========
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const name = mention(msg.from);
  await bot.sendMessage(
    chatId,
    card(
      'Menu Utama',
      `Halo ${name}\n\nBot create & manage VPS Railway.\nPilih menu di bawah.`,
      'v2 — deploy engine upgraded'
    ),
    { parse_mode: 'HTML', reply_markup: homeKeyboard }
  );
});

bot.onText(/^\/createvps$/, async (msg) => {
  await startCreateVps(msg);
});

bot.onText(/^\/settoken$/, async (msg) => {
  const chatId = msg.chat.id;
  setSession(chatId, { action: 'settoken', userId: msg.from.id });
  await bot.sendMessage(
    chatId,
    card(
      'Set Token Railway',
      `Halo ${mention(msg.from)}\n\nKirim <b>Railway Account Token</b> kamu.\nBuat di: railway.app → Account Settings → Tokens`,
      'Token disimpan hanya untuk akun Telegram ini.'
    ),
    { parse_mode: 'HTML', reply_markup: cancelKeyboard }
  );
});

bot.onText(/^\/mytoken$/, async (msg) => {
  const tok = getUserToken(msg.from.id);
  await bot.sendMessage(
    msg.chat.id,
    tok
      ? cardOk('Token Tersimpan', `Halo ${mention(msg.from)}\n\nToken Railway sudah terpasang.\nPreview: <code>${escapeHtml(tok.slice(0, 12))}…</code>`)
      : cardWarn('Belum Ada Token', `Halo ${mention(msg.from)}\n\nBelum set token. Pakai /settoken dulu.`),
    { parse_mode: 'HTML' }
  );
});

// ========== CALLBACK ==========
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const msg = {
    chat: query.message.chat,
    from: query.from,
    message_id: query.message.message_id,
  };

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (_) {}

  if (data === 'close') {
    try {
      await bot.deleteMessage(chatId, query.message.message_id);
    } catch (_) {}
    return;
  }
  if (data === 'cancel') {
    clearSession(chatId);
    await bot.sendMessage(chatId, cardWarn('Dibatalkan', 'Sesi dihentikan.'), { parse_mode: 'HTML' });
    return;
  }
  if (data === 'createvps') return startCreateVps(msg);
  if (data === 'settoken') {
    setSession(chatId, { action: 'settoken', userId: query.from.id });
    return bot.sendMessage(
      chatId,
      card('Set Token Railway', 'Kirim Railway Account Token kamu sekarang.', 'Dari Account Settings → Tokens'),
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }
  if (data === 'mytoken') {
    const tok = getUserToken(query.from.id);
    return bot.sendMessage(
      chatId,
      tok
        ? cardOk('Token Tersimpan', `Preview: <code>${escapeHtml(tok.slice(0, 12))}…</code>`)
        : cardWarn('Belum Ada Token', 'Pakai menu Set Token dulu.'),
      { parse_mode: 'HTML' }
    );
  }
  if (data === 'listproj') {
    const tok = getUserToken(query.from.id);
    if (!tok) {
      return bot.sendMessage(chatId, cardWarn('Token Kosong', 'Set token dulu dengan /settoken'), {
        parse_mode: 'HTML',
      });
    }
    try {
      const projects = await fetchProjects(tok);
      if (!projects.length) {
        return bot.sendMessage(chatId, card('Project', 'Tidak ada project di akun ini.'), {
          parse_mode: 'HTML',
        });
      }
      const list = projects.map((p) => `• <code>${escapeHtml(p.name)}</code>`).join('\n');
      return bot.sendMessage(chatId, card('Daftar Project', list), { parse_mode: 'HTML' });
    } catch (e) {
      return bot.sendMessage(chatId, cardErr('Gagal', escapeHtml(e.message)), { parse_mode: 'HTML' });
    }
  }
});

async function startCreateVps(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const tok = getUserToken(userId);

  if (!tok) {
    setSession(chatId, { action: 'createvps_token', userId });
    return bot.sendMessage(
      chatId,
      card(
        'Create VPS',
        `Halo ${mention(msg.from)}\n\nKirim <b>Railway Token</b> dulu, atau /settoken supaya tersimpan.`,
        'Account Token dari railway.app'
      ),
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }

  setSession(chatId, { action: 'createvps_name', userId, token: tok });
  return bot.sendMessage(
    chatId,
    card(
      'Create VPS',
      `Halo ${mention(msg.from)}, token siap.\n\nKirim <b>nama VPS</b>.\nContoh: <code>bot-vps-1</code> — huruf, angka, tanda hubung, tanpa spasi.`,
      'Setelah nama dikirim, deploy langsung jalan.'
    ),
    { parse_mode: 'HTML', reply_markup: cancelKeyboard }
  );
}

// ========== TEXT INPUT ==========
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const session = getSession(chatId);
  if (!session) return;

  const value = msg.text.trim();
  const userMention = mention(msg.from);

  // --- set token ---
  if (session.action === 'settoken') {
    if (value.length < 20) {
      return bot.sendMessage(chatId, cardErr('Token Pendek', 'Token Railway tidak valid.'), {
        parse_mode: 'HTML',
        reply_markup: cancelKeyboard,
      });
    }
    setUserToken(session.userId || msg.from.id, value);
    clearSession(chatId);
    try {
      await bot.deleteMessage(chatId, msg.message_id);
    } catch (_) {}
    return bot.sendMessage(
      chatId,
      cardOk('Token Disimpan', `Halo ${userMention}\n\nToken Railway berhasil disimpan.`),
      { parse_mode: 'HTML' }
    );
  }

  // --- createvps: terima token sekali pakai ---
  if (session.action === 'createvps_token') {
    if (value.length < 20) {
      return bot.sendMessage(chatId, cardErr('Token Pendek', 'Kirim token Railway yang benar.'), {
        parse_mode: 'HTML',
        reply_markup: cancelKeyboard,
      });
    }
    setUserToken(msg.from.id, value);
    setSession(chatId, { action: 'createvps_name', userId: msg.from.id, token: value.trim() });
    try {
      await bot.deleteMessage(chatId, msg.message_id);
    } catch (_) {}
    return bot.sendMessage(
      chatId,
      card(
        'Token Diterima',
        `Halo ${userMention}, token berhasil diterima.\n\nSekarang kirim <b>nama VPS</b>.\nContoh: <code>bot-vps-1</code>`,
        'Proses deploy mulai setelah nama dikirim.'
      ),
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }

  // --- createvps: nama lalu deploy ---
  if (session.action === 'createvps_name') {
    const apiToken = session.token || getUserToken(msg.from.id);
    if (!apiToken) {
      clearSession(chatId);
      return bot.sendMessage(chatId, cardErr('Token Hilang', 'Ulangi /createvps'), {
        parse_mode: 'HTML',
      });
    }

    let vpsName = value.replace(/\s+/g, '-');
    if (!/^[a-zA-Z0-9-]+$/.test(vpsName)) {
      return bot.sendMessage(
        chatId,
        cardErr('Nama Tidak Valid', 'Hanya huruf, angka, dan tanda hubung.'),
        { parse_mode: 'HTML', reply_markup: cancelKeyboard }
      );
    }

    clearSession(chatId);
    let loadMsg;
    try {
      loadMsg = await bot.sendMessage(
        chatId,
        card('Deploy', `Halo ${userMention}\n\nMemulai deploy <code>${escapeHtml(vpsName)}</code>...`),
        { parse_mode: 'HTML' }
      );

      const result = await deployVPS(apiToken, vpsName, {
        onProgress: async (step, text) => {
          try {
            await bot.editMessageText(
              card(`Deploy · ${step}/6`, `Halo ${userMention}\n\n${escapeHtml(text)}`),
              { chat_id: chatId, message_id: loadMsg.message_id, parse_mode: 'HTML' }
            );
          } catch (_) {}
        },
      });

      try {
        await bot.deleteMessage(chatId, loadMsg.message_id);
      } catch (_) {}

      await bot.sendMessage(
        chatId,
        cardOk(
          'VPS Siap!',
          `Halo ${userMention}\n\nVPS <code>${escapeHtml(result.name)}</code> berhasil dibuat.\nData login dikirim ke DM (jika memungkinkan).`,
          'Simpan password baik-baik.'
        ),
        { parse_mode: 'HTML' }
      );

      const detail =
        cardOk(
          'Data Login SSH',
          `Host: <code>${escapeHtml(result.ssh.host)}</code>\n` +
            `Port: <code>${result.ssh.port}</code>\n` +
            `User: <code>root</code>\n` +
            `Pass: <code>${escapeHtml(result.ssh.password)}</code>`,
          `ssh root@${result.ssh.host} -p ${result.ssh.port}`
        );

      try {
        await bot.sendMessage(msg.from.id, detail, { parse_mode: 'HTML' });
      } catch {
        await bot.sendMessage(chatId, detail, { parse_mode: 'HTML' });
      }
    } catch (error) {
      const errText = escapeHtml(error.message || String(error));
      try {
        await bot.editMessageText(
          cardErr(
            'Deploy Gagal',
            `Halo ${userMention}\n\nProses gagal.\n\n<code>${errText}</code>`,
            'Cek token Railway, kuota akun, dan logs di dashboard.'
          ),
          { chat_id: chatId, message_id: loadMsg?.message_id, parse_mode: 'HTML' }
        );
      } catch {
        await bot.sendMessage(
          chatId,
          cardErr('Deploy Gagal', `<code>${errText}</code>`, 'Coba /createvps lagi'),
          { parse_mode: 'HTML' }
        );
      }
    }
  }
});

bot.on('polling_error', (err) => console.error('[Telegram]', err.message));

console.log('');
console.log('╭──────────────────────────────╮');
console.log('│ VPS MANAGER BOT v2 • ONLINE  │');
console.log(`│ OWNER ID : ${OWNER_ID || '-'}            │`);
console.log('╰──────────────────────────────╯');
console.log('');
