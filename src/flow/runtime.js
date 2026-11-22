/* Runtime embedded in exported bots. This function is serialized by the
   compiler, so it must not close over imports or module scope. discord.js
   classes arrive through `deps`; Node built-ins and optional SDKs are loaded
   lazily inside operations. */
export function createFlowRuntime({ client, project = {}, deps = {} }) {
  const variables = new Map();
  const globals = Object.create(null);
  const functions = Object.create(null);
  const cooldowns = new Map();
  const caches = new Map();
  const aiMemory = new Map();
  const db = { ready: false, backend: null, connection: null, store: null, queue: Promise.resolve() };
  const music = { manager: null, players: new Map() };

  const str = (v, fallback = '') => (v === null || v === undefined ? fallback : String(v));
  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (v, fallback = false) => (v === undefined || v === null ? fallback : !!v);
  const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, num(ms))));
  const channelOf = (ctx, value) => {
    const target = value || ctx?.channel;
    if (!target) return null;
    if (typeof target === 'string') return client?.channels?.cache?.get(target) || null;
    return target;
  };
  const guildOf = (ctx, value) => value || ctx?.guild || ctx?.interaction?.guild || ctx?.message?.guild || null;

  function interpolate(template, values = {}) {
    return str(template).replace(/\{([\w.-]+)\}/g, (_, key) => str(values[key] ?? globals[key] ?? '', ''));
  }

  function componentsFrom(value) {
    const list = arr(value).flat(3).filter(Boolean);
    if (!list.length || !deps.ActionRowBuilder) return undefined;
    const rows = [];
    for (const entry of list) {
      if (entry?.constructor?.name === 'ActionRowBuilder') { rows.push(entry); continue; }
      if (entry?.type === 'row' || Array.isArray(entry?.components)) {
        rows.push(new deps.ActionRowBuilder().addComponents(...componentsFrom(entry.components || []).flatMap((r) => r.components)));
        continue;
      }
      let component = null;
      if (entry?.constructor?.name?.includes('Builder')) component = entry;
      else if (entry?.type === 'select' || entry?.kind) {
        const kind = str(entry.kind || 'String').toLowerCase();
        const Builder = kind === 'user' ? deps.UserSelectMenuBuilder
          : kind === 'role' ? deps.RoleSelectMenuBuilder
            : kind === 'channel' ? deps.ChannelSelectMenuBuilder
              : kind === 'mentionable' ? deps.MentionableSelectMenuBuilder
                : deps.StringSelectMenuBuilder;
        if (Builder) {
          component = new Builder().setCustomId(str(entry.customId || 'flow_select')).setPlaceholder(str(entry.placeholder || 'Choose…'))
            .setMinValues(num(entry.minValues, 1)).setMaxValues(num(entry.maxValues, 1));
          if (kind === 'string' && Array.isArray(entry.options)) {
            component.addOptions(entry.options.slice(0, 25).map((o) => ({ label: str(o.label || o.value), value: str(o.value || o.label) })));
          }
        }
      } else if (entry?.label || entry?.customId) {
        component = new deps.ButtonBuilder()
          .setCustomId(str(entry.customId || entry.label || 'flow_button'))
          .setLabel(str(entry.label || 'Button'))
          .setStyle(deps.ButtonStyle?.[entry.style] ?? deps.ButtonStyle?.Primary ?? 1)
          .setDisabled(!!entry.disabled);
        if (entry.emoji) component.setEmoji(str(entry.emoji));
      }
      if (!component) continue;
      const last = rows[rows.length - 1];
      if (last && last.components.length < 5 && !entry?.type?.includes('row')) last.addComponents(component);
      else rows.push(new deps.ActionRowBuilder().addComponents(component));
    }
    return rows.length ? rows : undefined;
  }

  function embedsFrom(value) {
    const list = arr(value).flat(3).filter(Boolean);
    if (!list.length || !deps.EmbedBuilder) return undefined;
    return list.map((entry) => {
      if (entry?.constructor?.name === 'EmbedBuilder') return entry;
      const e = obj(entry);
      const embed = new deps.EmbedBuilder();
      if (e.title) embed.setTitle(str(e.title));
      if (e.description) embed.setDescription(str(e.description));
      if (e.url) embed.setURL(str(e.url));
      if (e.color) embed.setColor(str(e.color));
      if (e.image) embed.setImage(str(e.image));
      if (e.thumbnail) embed.setThumbnail(str(e.thumbnail));
      if (e.footer) embed.setFooter({ text: str(e.footer) });
      if (Array.isArray(e.fields)) embed.addFields(e.fields.slice(0, 25).map((f) => ({
        name: str(f.name, 'Field'), value: str(f.value, '—'), inline: !!f.inline,
      })));
      return embed;
    });
  }

  function payload(args = {}) {
    const output = {};
    if (args.content !== undefined && args.content !== null && str(args.content).length) output.content = str(args.content);
    const embeds = embedsFrom(args.embeds);
    if (embeds) output.embeds = embeds;
    const components = componentsFrom(args.components || args.component);
    if (components) output.components = components;
    if (args.tts) output.tts = true;
    return output;
  }

  function interactionOf(ctx, args = {}) {
    return args.interaction || ctx?.interaction || ctx?.modalInteraction || null;
  }

  function messageOf(ctx, args = {}) {
    return args.message || ctx?.message || null;
  }

  function memberOf(ctx, args = {}) {
    return args.member || ctx?.member || ctx?.interaction?.member || null;
  }

  function modalFrom(value, fallback = {}) {
    if (value?.constructor?.name === 'ModalBuilder') return value;
    if (!deps.ModalBuilder) return null;
    const spec = obj(value);
    const modal = new deps.ModalBuilder()
      .setCustomId(str(spec.customId || fallback.customId || 'flow_modal'))
      .setTitle(str(spec.title || fallback.title || 'Flow modal').slice(0, 45));
    for (const input of arr(spec.inputs || fallback.inputs).slice(0, 5)) {
      const field = new deps.TextInputBuilder()
        .setCustomId(str(input.customId || 'input'))
        .setLabel(str(input.label || 'Input').slice(0, 45))
        .setStyle(str(input.style).toLowerCase() === 'paragraph' ? deps.TextInputStyle?.Paragraph : deps.TextInputStyle?.Short)
        .setRequired(input.required !== false);
      if (input.placeholder) field.setPlaceholder(str(input.placeholder));
      if (input.value) field.setValue(str(input.value));
      modal.addComponents(new deps.ActionRowBuilder().addComponents(field));
    }
    return modal;
  }

  async function jsonDbInit() {
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const file = project.database?.jsonPath || 'data/flow-db.json';
    db.file = file;
    db.backend = 'json';
    try {
      db.store = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      db.store = { collections: {} };
    }
    if (!db.store.collections) db.store.collections = {};
    await fsp.mkdir(path.dirname(file), { recursive: true });
    db.ready = true;
    return db;
  }

  async function saveJson() {
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const file = db.file;
    const temp = `${file}.${process.pid}.tmp`;
    const backup = `${file}.bak`;
    db.queue = db.queue.then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      try { await fsp.copyFile(file, backup); } catch { /* first write */ }
      await fsp.writeFile(temp, JSON.stringify(db.store, null, 2), 'utf8');
      await fsp.rename(temp, file);
    });
    return db.queue;
  }

  async function dbInit() {
    if (db.ready) return db;
    const backend = str(project.database?.backend || 'json').toLowerCase();
    if (backend === 'sqlite') {
      const { Sequelize } = await import('sequelize');
      const env = project.database?.env || 'DATABASE_URL';
      const fallback = `sqlite:${str(project.database?.jsonPath || 'data/flow.sqlite').replace(/\.json$/, '.sqlite')}`;
      const url = process.env[env] || fallback;
      db.connection = new Sequelize(url, { logging: false });
      await db.connection.query('CREATE TABLE IF NOT EXISTS flow_records (collection TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (collection, key))');
      db.backend = 'sqlite';
    } else if (backend === 'mongodb') {
      const { MongoClient } = await import('mongodb');
      const env = project.database?.env || 'DATABASE_URL';
      db.connection = new MongoClient(process.env[env] || 'mongodb://127.0.0.1:27017/cascade_flow');
      await db.connection.connect();
      db.collection = db.connection.db().collection('flow_records');
      await db.collection.createIndex({ collection: 1, key: 1 }, { unique: true });
      db.backend = 'mongodb';
    } else {
      await jsonDbInit();
    }
    db.ready = true;
    return db;
  }

  function filterRows(rows, filter) {
    if (!filter || typeof filter !== 'object') return rows;
    return rows.filter((row) => Object.entries(filter).every(([key, value]) => {
      const actual = key.includes('.') ? key.split('.').reduce((v, k) => (v == null ? v : v[k]), row) : row[key];
      return actual === value || String(actual) === String(value);
    }));
  }

  async function dbSet(collection, key, value) {
    await dbInit();
    const coll = str(collection || 'default');
    const id = str(key);
    if (db.backend === 'json') {
      db.store.collections[coll] ||= {};
      db.store.collections[coll][id] = value;
      await saveJson();
    } else if (db.backend === 'sqlite') {
      await db.connection.query(
        'INSERT INTO flow_records (collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value',
        { replacements: [coll, id, JSON.stringify(value)] },
      );
    } else {
      await db.collection.updateOne(
        { collection: coll, key: id },
        { $set: { collection: coll, key: id, value, updatedAt: new Date() } },
        { upsert: true },
      );
    }
    return value;
  }

  async function dbGet(collection, key) {
    await dbInit();
    const coll = str(collection || 'default');
    const id = str(key);
    if (db.backend === 'json') return db.store.collections[coll]?.[id];
    if (db.backend === 'sqlite') {
      const [rows] = await db.connection.query('SELECT value FROM flow_records WHERE collection = ? AND key = ? LIMIT 1', { replacements: [coll, id] });
      return rows[0] ? JSON.parse(rows[0].value) : undefined;
    }
    const row = await db.collection.findOne({ collection: coll, key: id });
    return row?.value;
  }

  async function dbAll(collection) {
    await dbInit();
    const coll = str(collection || 'default');
    if (db.backend === 'json') return Object.entries(db.store.collections[coll] || {}).map(([key, value]) => ({ key, value }));
    if (db.backend === 'sqlite') {
      const [rows] = await db.connection.query('SELECT key, value FROM flow_records WHERE collection = ?', { replacements: [coll] });
      return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
    }
    return (await db.collection.find({ collection: coll }).toArray()).map((r) => ({ key: r.key, value: r.value }));
  }

  async function dbDelete(collection, key) {
    await dbInit();
    const coll = str(collection || 'default');
    const id = str(key);
    if (db.backend === 'json') {
      const existed = !!db.store.collections[coll]?.[id];
      if (db.store.collections[coll]) delete db.store.collections[coll][id];
      await saveJson();
      return existed;
    }
    if (db.backend === 'sqlite') {
      const [rows] = await db.connection.query('SELECT key FROM flow_records WHERE collection = ? AND key = ?', { replacements: [coll, id] });
      await db.connection.query('DELETE FROM flow_records WHERE collection = ? AND key = ?', { replacements: [coll, id] });
      return rows.length > 0;
    }
    const result = await db.collection.deleteOne({ collection: coll, key: id });
    return !!result.deletedCount;
  }

  async function openaiClient(args = {}) {
    const apiKey = process.env[str(args.env || 'OPENAI_API_KEY')];
    if (!apiKey) throw new Error(`Missing ${str(args.env || 'OPENAI_API_KEY')} in the environment`);
    const imported = await import('openai');
    const OpenAI = imported.default || imported.OpenAI;
    const baseURL = process.env[str(args.baseUrlEnv || 'OPENAI_BASE_URL')] || undefined;
    return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async function httpRequest(args = {}) {
    const url = str(args.url);
    if (!url) throw new Error('HTTP request needs a URL');
    const method = str(args.method || 'GET').toUpperCase();
    const headers = { ...obj(args.headers) };
    for (const [key, value] of Object.entries(headers)) headers[key] = str(value);
    if (args.authEnv && process.env[str(args.authEnv)]) headers.authorization = `Bearer ${process.env[str(args.authEnv)]}`;
    let body;
    if (args.body !== undefined && args.body !== null && !['GET', 'HEAD'].includes(method)) {
      body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    const timeout = Math.max(1000, num(args.timeoutMs, 10000));
    const retries = Math.max(0, Math.min(5, num(args.retries, 2)));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { method, headers, body, signal: controller.signal });
        clearTimeout(timer);
        const text = await res.text();
        let parsed = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* text response */ }
        const responseHeaders = Object.fromEntries(res.headers.entries());
        if (!res.ok && attempt < retries) { lastError = new Error(`HTTP ${res.status}`); await sleep(250 * (attempt + 1)); continue; }
        return { status: res.status, ok: res.ok, body: parsed, headers: responseHeaders };
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < retries) await sleep(250 * (attempt + 1));
      }
    }
    throw lastError || new Error('HTTP request failed');
  }

  async function musicManager(args = {}) {
    if (music.manager) return music.manager;
    const imported = await import('shoukaku');
    const nodes = arr(project.lavalink?.nodes || args.nodes).map((node) => ({
      name: str(node.name || 'main'),
      url: str(node.url || 'localhost:2333'),
      auth: process.env[str(node.authEnv || 'LAVALINK_PASSWORD')] || '',
      secure: !!node.secure,
    })).filter((node) => node.auth);
    if (!nodes.length) throw new Error('Lavalink is not configured; set project.lavalink.nodes and LAVALINK_PASSWORD');
    const connector = new imported.Connectors.DiscordJS(client);
    music.manager = new imported.Shoukaku(connector, nodes, {
      moveOnDisconnect: true, resume: true, resumeTimeout: 60, reconnectTries: 5,
      restTimeout: 15000, userAgent: 'CascadeFlow/1.0',
    });
    return music.manager;
  }

  async function op(ctx, name, rawArgs = {}) {
    const args = obj(rawArgs);
    switch (name) {
      case 'client.create': return { client };
      case 'client.login': {
        const token = process.env[str(args.tokenEnv || project.tokenEnv || 'DISCORD_TOKEN')];
        if (!token) throw new Error(`Missing ${str(args.tokenEnv || project.tokenEnv || 'DISCORD_TOKEN')}`);
        if (!client.isReady?.()) await client.login(token);
        return {};
      }
      case 'client.destroy': await client.destroy(); return {};
      case 'config.note': return {};
      case 'presence.set': {
        const type = str(args.activityType || 'Playing');
        const activity = { name: str(args.text || args.name || 'Cascade Flow'), type: deps.ActivityType?.[type] ?? deps.ActivityType?.Playing };
        if (type === 'Custom' && deps.ActivityType) activity.type = deps.ActivityType.Custom;
        if (args.url) activity.url = str(args.url);
        client.user?.setPresence({ status: str(args.status || 'online'), activities: [activity] });
        return {};
      }
      case 'presence.rotate': {
        const lines = str(args.activities || '').split('\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) return {};
        let i = 0;
        const apply = () => client.user?.setPresence({ activities: [{ name: lines[i++ % lines.length] }], status: 'online' });
        apply();
        const timer = setInterval(apply, Math.max(10, num(args.intervalSeconds, 30)) * 1000);
        timer.unref?.();
        return {};
      }
      case 'error.handle': {
        if (bool(args.log, true)) console.error('[flow]', args.error || ctx?.error);
        if (bool(args.reply, false) && ctx?.interaction) {
          const method = ctx.interaction.deferred || ctx.interaction.replied ? 'editReply' : 'reply';
          await ctx.interaction[method]({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
        }
        return {};
      }
      case 'discord.interaction.reply':
      case 'discord.interaction.followUp':
      case 'discord.interaction.editReply': {
        const interaction = interactionOf(ctx, args);
        if (!interaction) {
          // Prefix commands have a message context instead of an interaction.
          // Route the shared Reply node through the message so one graph can
          // be reused by both slash and prefix scripts.
          const message = messageOf(ctx, args);
          if (!message) throw new Error('No interaction or message in this context');
          const body = payload(args);
          if (name.endsWith('editReply') || name.endsWith('followUp') || args.mode === 'followUp') {
            const target = message.channel || message;
            const sent = await target.send(body);
            return { message: sent };
          }
          const sent = await message.reply(body);
          return { message: sent };
        }
        const method = name.endsWith('followUp') ? 'followUp' : name.endsWith('editReply') ? 'editReply' : (args.mode === 'followUp' ? 'followUp' : args.mode === 'editReply' ? 'editReply' : 'reply');
        const body = payload(args);
        if (bool(args.ephemeral, false) && method !== 'editReply') body.ephemeral = true;
        if (method === 'editReply') await interaction.editReply(body);
        else await interaction[method](body);
        return {};
      }
      case 'discord.interaction.defer': {
        const interaction = interactionOf(ctx, args);
        if (!interaction) throw new Error('No interaction in this context');
        const method = args.mode === 'deferUpdate' ? 'deferUpdate' : 'deferReply';
        await interaction[method]({ ephemeral: bool(args.ephemeral, false) });
        return {};
      }
      case 'discord.interaction.autocomplete': {
        const interaction = interactionOf(ctx, args);
        if (!interaction) throw new Error('No interaction in this context');
        await interaction.respond(arr(args.choices).map((c) => (typeof c === 'string' ? { name: c, value: c } : { name: str(c.name ?? c.value), value: c.value ?? c.name })));
        return {};
      }
      case 'discord.commands.register': return { registered: !!client.isReady?.() };
      case 'discord.message.reply': {
        const message = messageOf(ctx, args);
        if (!message) throw new Error('No message in this context');
        const body = payload(args);
        if (!bool(args.mention, true) && message.author) body.allowedMentions = { repliedUser: false };
        const sent = await message.reply(body);
        return { message: sent };
      }
      case 'discord.message.send': {
        const channel = channelOf(ctx, args.channel);
        if (!channel?.send) throw new Error('No sendable channel in this context');
        const sent = await channel.send(payload(args));
        return { message: sent };
      }
      case 'discord.message.edit': {
        const message = messageOf(ctx, args);
        if (!message?.edit) throw new Error('No message to edit');
        return { message: await message.edit(payload(args)) };
      }
      case 'discord.message.delete': {
        const message = messageOf(ctx, args);
        if (!message?.delete) throw new Error('No message to delete');
        await message.delete();
        return {};
      }
      case 'discord.message.fetch': {
        const channel = channelOf(ctx, args.channel);
        const message = await channel?.messages?.fetch?.(str(args.messageId));
        return { message };
      }
      case 'discord.message.history': {
        const channel = channelOf(ctx, args.channel);
        const messages = await channel?.messages?.fetch?.({ limit: Math.max(1, Math.min(100, num(args.limit, 20))) });
        return { messages: messages ? [...messages.values()] : [] };
      }
      case 'discord.message.collect': {
        const channel = channelOf(ctx, args.channel);
        if (!channel?.awaitMessages) throw new Error('No channel to collect messages from');
        const author = ctx?.message?.author?.id;
        const filter = args.filter === 'same-author' && author ? (m) => m.author.id === author : () => true;
        const collected = await channel.awaitMessages({ filter, max: 1, time: Math.max(1000, num(args.timeSeconds, 30) * 1000) });
        return { message: collected.first() || null };
      }
      case 'discord.message.react': {
        const message = messageOf(ctx, args);
        if (!message?.react) throw new Error('No message to react to');
        await message.react(str(args.emoji || '✅'));
        return {};
      }
      case 'discord.message.pin': {
        const message = messageOf(ctx, args);
        await message?.pin?.();
        return {};
      }
      case 'discord.message.schedule': {
        const channel = channelOf(ctx, args.channel);
        setTimeout(() => channel?.send?.(payload(args)).catch(() => {}), Math.max(1, num(args.delaySeconds, 60)) * 1000).unref?.();
        return {};
      }
      case 'discord.poll.create': {
        const channel = channelOf(ctx, args.channel);
        if (!channel?.send) throw new Error('No channel for poll');
        const answers = str(args.answers || 'Yes\nNo').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const sent = await channel.send({
          poll: { question: { text: str(args.question || 'Vote') }, answers: answers.map((text) => ({ text })), duration: Math.max(1, num(args.durationHours, 24)), allowMultiselect: !!args.multiple },
        });
        return { message: sent };
      }
      case 'embed.create': return { embed: (embedsFrom([args]) || [])[0] || null };
      case 'embed.field': return { field: { name: str(args.name), value: str(args.value), inline: !!args.inline } };
      case 'component.button': {
        if (!deps.ButtonBuilder) throw new Error('discord.js ButtonBuilder is unavailable');
        const b = new deps.ButtonBuilder().setCustomId(str(args.customId || 'flow_button')).setLabel(str(args.label || 'Button'))
          .setStyle(deps.ButtonStyle?.[str(args.style || 'Primary')] ?? deps.ButtonStyle?.Primary ?? 1).setDisabled(!!args.disabled);
        if (args.emoji) b.setEmoji(str(args.emoji));
        return { component: b };
      }
      case 'component.select': {
        const rows = componentsFrom([{ type: 'select', ...args }]);
        return { component: rows?.[0]?.components?.[0] || null };
      }
      case 'component.row': {
        const rows = componentsFrom(args.components);
        return { row: rows?.[0] || null };
      }
      case 'modal.create': return { modal: modalFrom(args) };
      case 'discord.modal.show': {
        const interaction = interactionOf(ctx, args);
        if (!interaction) throw new Error('No interaction for modal');
        const modal = modalFrom(args.modal);
        if (!modal) throw new Error('Could not build modal');
        await interaction.showModal(modal);
        return {};
      }
      case 'discord.component.update': {
        const interaction = interactionOf(ctx, args);
        if (!interaction) throw new Error('No component interaction');
        await interaction.update(payload(args));
        return {};
      }
      case 'discord.component.collect': {
        const message = messageOf(ctx, args);
        if (!message?.awaitMessageComponent) throw new Error('No message to collect from');
        const interaction = await message.awaitMessageComponent({ time: Math.max(1000, num(args.timeSeconds, 60) * 1000) });
        return { interaction };
      }
      case 'discord.guild.info': {
        const guild = guildOf(ctx, args.guild);
        return guild ? { name: guild.name, memberCount: guild.memberCount, ownerId: guild.ownerId, createdAt: guild.createdAt?.toISOString?.() } : {};
      }
      case 'discord.member.info': {
        const member = memberOf(ctx, args);
        return member ? { displayName: member.displayName, joinedAt: member.joinedAt?.toISOString?.(), roles: member.roles?.cache?.map?.((r) => r.id) || [], isOwner: member.guild?.ownerId === member.id } : {};
      }
      case 'discord.user.info': {
        const user = args.user || ctx?.user || ctx?.message?.author;
        return user ? { username: user.username, id: user.id, bot: !!user.bot, createdAt: user.createdAt?.toISOString?.() } : {};
      }
      case 'discord.member.kick': { const m = memberOf(ctx, args); await m?.kick?.(str(args.reason)); return {}; }
      case 'discord.member.ban': { const m = memberOf(ctx, args); await m?.ban?.({ reason: str(args.reason), deleteMessageSeconds: Math.max(0, num(args.deleteDays)) * 86400 }); return {}; }
      case 'discord.member.timeout': { const m = memberOf(ctx, args); await m?.timeout?.(Math.max(1, num(args.minutes, 10)) * 60000, str(args.reason)); return {}; }
      case 'discord.role.add': { const m = memberOf(ctx, args); await m?.roles?.add?.(args.role || str(args.roleId)); return {}; }
      case 'discord.role.remove': { const m = memberOf(ctx, args); await m?.roles?.remove?.(args.role || str(args.roleId)); return {}; }
      case 'discord.role.create': { const g = guildOf(ctx, args.guild); const role = await g?.roles?.create?.({ name: str(args.name || 'Role'), color: str(args.color || '#6366f1'), permissions: arr(args.permissions) }); return { role }; }
      case 'discord.channel.create': { const g = guildOf(ctx, args.guild); const channel = await g?.channels?.create?.({ name: str(args.name || 'channel'), type: channelType(args.type, deps), parent: args.parentId || undefined }); return { channel }; }
      case 'discord.channel.delete': { await (args.channel || channelOf(ctx))?.delete?.(); return {}; }
      case 'discord.thread.create': { const ch = channelOf(ctx, args.channel); const thread = await ch?.threads?.create?.({ name: str(args.name || 'Thread'), private: !!args.private }); return { thread }; }
      case 'discord.invite.create': { const ch = channelOf(ctx, args.channel); const invite = await ch?.createInvite?.({ maxAge: num(args.maxAge, 86400), maxUses: num(args.maxUses, 0), unique: !!args.unique }); return { url: invite?.url }; }
      case 'discord.audit.logs': { const g = guildOf(ctx, args.guild); const logs = await g?.fetchAuditLogs?.({ limit: Math.min(50, num(args.limit, 10)) }); return { entries: logs?.entries?.map?.((e) => ({ action: e.action, targetId: e.targetId, executorId: e.executorId })) || [] }; }
      case 'discord.welcome': {
        const member = memberOf(ctx, args);
        const id = str(args.channelId || 'WELCOME_CHANNEL_ID');
        const channel = channelOf(ctx, process.env[id] || id);
        await channel?.send?.(interpolate(args.message || 'Welcome {user}!', { user: member?.user?.username, guild: member?.guild?.name }));
        return {};
      }
      case 'discord.reactionRole': {
        const roleId = str(args.roleId || process.env.REACTION_ROLE_ID);
        if (roleId && ctx?.user && ctx?.reaction?.message?.guild) {
          const member = await ctx.reaction.message.guild.members.fetch(ctx.user.id);
          await member.roles.add(roleId);
        }
        return {};
      }
      case 'discord.ticket.create': {
        const interaction = interactionOf(ctx, args);
        const guild = interaction?.guild;
        if (!guild) throw new Error('Tickets require a guild interaction');
        const channel = await guild.channels.create({
          name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
          parent: args.categoryId || undefined,
          permissionOverwrites: [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            ...(args.staffRoleId ? [{ id: str(args.staffRoleId), allow: ['ViewChannel', 'SendMessages'] }] : []),
          ],
        });
        await channel.send(str(args.welcome || 'A staff member will be with you shortly.'));
        return { channel };
      }
      case 'discord.permissions.check': {
        const member = memberOf(ctx, args);
        return { allowed: !!member?.permissions?.has?.(str(args.permission)) };
      }
      case 'logic.delay': await sleep(num(args.ms, 1000)); return {};
      case 'logic.log': console.log('[flow]', args.message ?? args.value ?? ''); return {};
      case 'logic.assert': if (!args.condition) throw new Error(str(args.message || 'Assertion failed')); return {};
      case 'logic.breakpoint': if (bool(args.enabled, true)) console.log(`[flow:breakpoint] ${str(args.label || 'breakpoint')}`, ctx?.scriptId); return {};
      case 'command.option': {
        const value = ctx?.interaction?.options?.get?.(str(args.name)) ?? args.fallback;
        return { value };
      }
      case 'command.permission': {
        const member = memberOf(ctx, args);
        const permissions = arr(args.permission).length ? arr(args.permission) : [str(args.permission || 'ManageGuild')];
        return { allowed: permissions.every((p) => !!member?.permissions?.has?.(p)) };
      }
      case 'command.cooldown': {
        const scope = str(args.scope || 'user');
        const key = `${ctx?.scriptId || 'flow'}:${scope}:${scope === 'guild' ? ctx?.guild?.id : scope === 'global' ? '*' : (ctx?.user?.id || ctx?.interaction?.user?.id || 'anon')}:${str(args.key || 'default')}`;
        const until = cooldowns.get(key) || 0;
        const now = Date.now();
        if (until > now) return { allowed: false, remaining: Math.ceil((until - now) / 1000) };
        cooldowns.set(key, now + Math.max(0, num(args.seconds, 5)) * 1000);
        return { allowed: true, remaining: 0 };
      }
      case 'data.text': return { value: str(args.value) };
      case 'data.number': return { value: num(args.value) };
      case 'data.boolean': return { value: !!args.value };
      case 'data.json': return { value: args.value ?? null };
      case 'data.template': {
        const values = { ...globals };
        for (const [key, value] of Object.entries(args)) if (key !== 'template') values[key] = value;
        return { value: interpolate(args.template, values) };
      }
      case 'data.array': return { value: arr(args.items) };
      case 'data.object': return { value: obj(args.value) };
      case 'data.map': return { value: { ...obj(args.entries), ...obj(args.value) } };
      case 'data.set': return { value: [...new Set(arr(args.items ?? args.value))] };
      case 'data.arrayOp': {
        const list = arr(args.input);
        const op = str(args.operation);
        if (op === 'push') return { value: [...list, ...(Array.isArray(args.argument) ? args.argument : [args.argument])] };
        const rawArgument = str(args.argument);
        const [path, expected] = rawArgument.includes('=')
          ? [rawArgument.slice(0, rawArgument.indexOf('=')).trim(), rawArgument.slice(rawArgument.indexOf('=') + 1)]
          : [rawArgument.trim(), undefined];
        const pick = (entry) => (path ? path.split('.').reduce((value, key) => (value == null ? value : value[key]), entry) : entry);
        const matches = (entry) => (expected === undefined ? !!pick(entry) : String(pick(entry)) === expected);
        if (op === 'map') return { value: list.map((entry) => pick(entry)) };
        if (op === 'filter') return { value: list.filter(matches) };
        if (op === 'find') return { value: list.find(matches) ?? null };
        if (op === 'join') return { value: list.join(str(args.argument, ',')) };
        if (op === 'slice') return { value: list.slice(0, num(args.argument, list.length)) };
        if (op === 'sort') return { value: [...list].sort() };
        if (op === 'length') return { value: list.length };
        if (op === 'unique') return { value: [...new Set(list)] };
        return { value: list };
      }
      case 'data.stringOp': {
        const input = str(args.input);
        const op = str(args.operation);
        if (op === 'uppercase') return { value: input.toUpperCase() };
        if (op === 'lowercase') return { value: input.toLowerCase() };
        if (op === 'trim') return { value: input.trim() };
        if (op === 'split') return { value: input.split(str(args.a, '\n')) };
        if (op === 'replace') return { value: input.split(str(args.a)).join(str(args.b)) };
        if (op === 'includes') return { value: input.includes(str(args.a)) };
        if (op === 'slice') return { value: input.slice(num(args.a), num(args.b, input.length)) };
        if (op === 'length') return { value: input.length };
        return { value: input };
      }
      case 'data.math': {
        const a = num(args.a), b = num(args.b), op = str(args.operation);
        const result = op === 'add' ? a + b : op === 'subtract' ? a - b : op === 'multiply' ? a * b : op === 'divide' ? (b === 0 ? 0 : a / b) : op === 'modulo' ? (b === 0 ? 0 : a % b) : op === 'power' ? a ** b : op === 'round' ? Math.round(a) : op === 'min' ? Math.min(a, b) : op === 'max' ? Math.max(a, b) : Math.abs(a);
        return { value: result };
      }
      case 'data.compare': {
        const a = args.a, b = args.b, op = str(args.operator, '==');
        const result = op === '==' ? a == b : op === '!=' ? a != b : op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : op === 'includes' ? arr(a).includes(b) || str(a).includes(str(b)) : op === 'startsWith' ? str(a).startsWith(str(b)) : str(a).endsWith(str(b));
        return { value: !!result };
      }
      case 'data.random': return { value: bool(args.integer, true) ? Math.floor(Math.random() * (num(args.max, 100) - num(args.min, 1) + 1)) + num(args.min, 1) : Math.random() * (num(args.max, 1) - num(args.min, 0)) + num(args.min, 0) };
      case 'data.date': {
        const op = str(args.operation, 'now');
        if (op === 'now') return { value: new Date().toISOString() };
        const date = args.input ? new Date(str(args.input)) : new Date();
        if (op === 'format') return { value: date.toISOString() };
        if (op === 'add') { date.setTime(date.getTime() + num(args.amount) * ({ minutes: 60000, hours: 3600000, days: 86400000 }[str(args.unit || 'days')] || 86400000)); return { value: date.toISOString() }; }
        return { value: date.getTime() };
      }
      case 'data.jsonOp': {
        const op = str(args.operation, 'parse');
        if (op === 'stringify') return { value: JSON.stringify(args.input) };
        if (op === 'parse') { try { return { value: typeof args.input === 'string' ? JSON.parse(args.input) : args.input }; } catch { return { value: null }; } }
        const value = obj(args.input);
        if (op === 'get') return { value: str(args.path).split('.').reduce((v, k) => (v == null ? v : v[k]), value) };
        if (op === 'keys') return { value: Object.keys(value) };
        return { value: { ...value, ...obj(args.path) } };
      }
      case 'data.regex': {
        const input = str(args.input);
        let re;
        try { re = new RegExp(str(args.pattern), str(args.flags, 'g')); } catch { return { value: null }; }
        if (args.replacement !== undefined) return { value: input.replace(re, str(args.replacement)) };
        const match = input.match(re);
        return { value: match ? [...match] : null };
      }
      case 'data.env': return { value: process.env[str(args.name)] ?? str(args.fallback) };
      case 'data.coalesce': return { value: [args.a, args.b, args.c].find((v) => v !== undefined && v !== null && v !== '') ?? null };
      case 'data.convert': {
        const to = str(args.to);
        if (to === 'number') return { value: num(args.input) };
        if (to === 'boolean') return { value: !!args.input && args.input !== 'false' };
        if (to === 'json') { try { return { value: typeof args.input === 'string' ? JSON.parse(args.input) : args.input }; } catch { return { value: null }; } }
        return { value: args.input === undefined || args.input === null ? '' : typeof args.input === 'string' ? args.input : JSON.stringify(args.input) };
      }
      case 'data.validate': {
        const value = args.input;
        const kind = str(args.kind, 'string');
        let valid = value !== undefined && value !== null;
        if (kind === 'email') valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(value));
        if (kind === 'url') { try { new URL(str(value)); } catch { valid = false; } }
        if (kind === 'discordId') valid = /^\d{15,25}$/.test(str(value));
        if (kind === 'number') valid = Number.isFinite(Number(value));
        if (kind === 'string') valid = str(value).length >= num(args.minLength, 0);
        if (kind === 'json') { try { JSON.parse(str(value)); valid = true; } catch { valid = typeof value === 'object'; } }
        return { valid: !!valid, value };
      }
      case 'data.cache': {
        const key = str(args.key || 'key');
        const now = Date.now();
        const hit = caches.get(key);
        if (hit && hit.until > now) return { value: hit.value };
        caches.set(key, { value: args.value, until: now + Math.max(1, num(args.ttlSeconds, 60)) * 1000 });
        return { value: args.value };
      }
      case 'data.varGet': {
        const scope = str(args.scope || 'script');
        const value = scope === 'global' ? globals[str(args.name)] : variables.get(`${ctx?.scriptId || 'flow'}:${str(args.name)}`);
        return { value };
      }
      case 'data.varSet': {
        const scope = str(args.scope || 'script');
        if (scope === 'global') globals[str(args.name)] = args.value;
        else variables.set(`${ctx?.scriptId || 'flow'}:${str(args.name)}`, args.value);
        return { value: args.value };
      }
      case 'script.useFromMain': {
        const value = globals[str(args.name)];
        if (value === undefined && str(args.kind) === 'function') return { value: functions[str(args.name)] };
        return { value };
      }
      case 'script.import': return { value: str(args.scriptId) };
      case 'script.callFunction': return { result: await functions[str(args.name)]?.(args.args) };
      case 'script.defineFunction': {
        const params = str(args.params || '').split(',').map((p) => p.trim()).filter(Boolean);
        try {
          const fn = new Function(...params, `return (async () => { ${str(args.body)} })();`);
          functions[str(args.name)] = async (callArgs = {}) => {
            const values = params.map((p) => callArgs?.[p] ?? globals[p]);
            return fn(...values);
          };
        } catch (error) {
          throw new Error(`Could not compile function ${str(args.name)}: ${error.message}`);
        }
        return { function: functions[str(args.name)] };
      }
      case 'script.custom': {
        try {
          const fn = new Function('args', 'ctx', 'runtime', `return (async () => { ${str(args.code)} })();`);
          return { result: await fn(args.args, ctx, { op, globals, functions, db }) };
        } catch (error) {
          throw new Error(`Custom JavaScript failed: ${error.message}`);
        }
      }
      case 'db.connect': { await dbInit(); return { database: db }; }
      case 'db.schema': {
        await dbInit();
        if (db.backend === 'sqlite') {
          await db.connection.query(`CREATE TABLE IF NOT EXISTS ${str(args.name || 'flow_model').replace(/[^a-z0-9_]/gi, '_')} (id TEXT PRIMARY KEY, data TEXT, created_at TEXT)`);
        } else if (db.backend === 'mongodb' && db.collection) {
          await db.collection.createIndex({ collection: 1, key: 1 }, { unique: true }).catch(() => {});
        }
        return {};
      }
      case 'db.set': { const value = await dbSet(args.collection, args.key, args.value); return { value }; }
      case 'db.get': { const value = await dbGet(args.collection, args.key); return { value, found: value !== undefined }; }
      case 'db.delete': return { deleted: await dbDelete(args.collection, args.key) };
      case 'db.query': {
        const rows = filterRows(await dbAll(args.collection), args.filter).slice(0, Math.max(1, num(args.limit, 50)));
        return { rows, count: rows.length };
      }
      case 'db.aggregate': return { rows: filterRows(await dbAll(args.collection), args.filter || null) };
      case 'db.transaction': {
        const results = [];
        for (const operation of arr(args.operations)) {
          if (operation && operation.op) results.push(await op(ctx, operation.op, operation.args || {}));
        }
        return { result: results };
      }
      case 'db.inspect': { const rows = (await dbAll(args.collection)).slice(0, Math.max(1, num(args.limit, 10))); return { rows }; }
      case 'ai.chat':
      case 'ai.json':
      case 'ai.tools': {
        const ai = await openaiClient(args);
        const memory = aiMemory.get(str(args.memoryKey || ctx?.scriptId || 'default')) || [];
        const messages = [
          ...(args.system ? [{ role: 'system', content: str(args.system) }] : []),
          ...memory,
          { role: 'user', content: args.image ? [{ type: 'text', text: str(args.prompt) }, { type: 'image_url', image_url: { url: str(args.image) } }] : str(args.prompt) },
        ];
        const body = { model: str(args.model || 'gpt-4.1-mini'), messages, temperature: num(args.temperature, 0.7), max_tokens: Math.max(1, num(args.maxTokens, 800)) };
        if (name === 'ai.json') body.response_format = { type: 'json_object' };
        if (name === 'ai.tools') body.tools = arr(args.tools).map((t) => (typeof t === 'string' ? { type: 'function', function: { name: t, parameters: { type: 'object', properties: {} } } } : t));
        const completion = await ai.chat.completions.create(body);
        const message = completion.choices?.[0]?.message;
        const text = str(message?.content);
        if (args.memoryKey) aiMemory.set(str(args.memoryKey), [...memory, { role: 'user', content: str(args.prompt) }, { role: 'assistant', content: text }].slice(-Math.max(2, num(args.limit, 20))));
        if (name === 'ai.json') {
          try { return { value: JSON.parse(text) }; } catch { return { value: null }; }
        }
        return { text, usage: completion.usage || null, calls: message?.tool_calls || [] };
      }
      case 'ai.memory': {
        const key = str(args.key || 'default');
        const list = aiMemory.get(key) || [];
        if (args.text) aiMemory.set(key, [...list, { role: 'user', content: str(args.text) }].slice(-Math.max(2, num(args.limit, 20))));
        return { messages: aiMemory.get(key) || [] };
      }
      case 'ai.embed': {
        const ai = await openaiClient(args);
        const result = await ai.embeddings.create({ model: str(args.model || 'text-embedding-3-small'), input: str(args.text) });
        return { vector: result.data?.[0]?.embedding || [] };
      }
      case 'ai.image': {
        const ai = await openaiClient(args);
        const result = await ai.images.generate({ model: str(args.model || 'gpt-image-1'), prompt: str(args.prompt), size: str(args.size || '1024x1024') });
        return { url: result.data?.[0]?.url || '', base64: result.data?.[0]?.b64_json || '' };
      }
      case 'ai.moderation': {
        const ai = await openaiClient(args);
        const result = await ai.moderations.create({ model: str(args.model || 'omni-moderation-latest'), input: str(args.input) });
        return { flagged: !!result.results?.[0]?.flagged, categories: result.results?.[0]?.categories || {} };
      }
      case 'http.request': return await httpRequest(args);
      case 'http.webhook': return { payload: {} };
      case 'http.websocket': {
        const ws = new WebSocket(str(args.url));
        const message = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 15000);
          ws.addEventListener('open', () => { if (args.message) ws.send(str(args.message)); });
          ws.addEventListener('message', (event) => { clearTimeout(timer); resolve(event.data); ws.close(); });
          ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket error')); });
        });
        return { message };
      }
      case 'http.paginate': {
        const items = [];
        let url = str(args.url);
        for (let page = 0; page < Math.max(1, num(args.maxPages, 10)) && url; page += 1) {
          const result = await httpRequest({ url, method: 'GET' });
          const chunk = str(args.itemsPath).split('.').reduce((v, k) => (v == null ? v : v[k]), result.body);
          items.push(...arr(chunk));
          const next = str(args.nextPath).split('.').reduce((v, k) => (v == null ? v : v[k]), result.body);
          url = next ? (String(next).startsWith('http') ? String(next) : new URL(String(next), url).toString()) : null;
        }
        return { items };
      }
      case 'music.connect': { const manager = await musicManager(args); return { manager }; }
      case 'music.join': {
        const manager = await musicManager(args);
        const guildId = guildOf(ctx, args.guild)?.id;
        const voice = args.channel || memberOf(ctx, args)?.voice?.channel;
        if (!guildId || !voice) throw new Error('Join requires a guild and voice channel');
        const player = manager.players.get(guildId) || await manager.joinVoiceChannel({ guildId, channelId: voice.id, shardId: 0, deaf: true });
        music.players.set(guildId, player);
        return { player };
      }
      case 'music.leave': {
        const manager = await musicManager(args);
        const guildId = guildOf(ctx, args)?.id;
        if (!guildId) throw new Error('Leave requires a guild');
        const player = manager.players.get(guildId);
        await player?.destroy?.();
        await manager.leaveVoiceChannel?.(guildId);
        music.players.delete(guildId);
        return {};
      }
      case 'music.search': {
        const manager = await musicManager(args);
        const node = manager.getIdealNode?.();
        if (!node?.rest?.resolve) throw new Error('No healthy Lavalink node');
        const result = await node.rest.resolve(str(args.query));
        const tracks = result?.tracks || (result?.data?.tracks || []);
        return { tracks };
      }
      case 'music.play': {
        const manager = await musicManager(args);
        const guildId = guildOf(ctx, args.guild)?.id;
        const voice = memberOf(ctx, args)?.voice?.channel || args.channel;
        if (!guildId || !voice) throw new Error('Play requires a guild and voice channel');
        const player = manager.players.get(guildId) || await manager.joinVoiceChannel({ guildId, channelId: voice.id, shardId: 0, deaf: true });
        await player.playTrack({ track: args.track || args });
        return { queue: player.queue || [] };
      }
      case 'music.queue': {
        const manager = await musicManager(args);
        const player = manager.players.get(guildOf(ctx, args)?.id);
        if (!player) return { queue: [] };
        const action = str(args.action || 'skip');
        if (action === 'pause') await player.pause?.(true);
        if (action === 'resume') await player.pause?.(false);
        if (action === 'skip') await player.skip?.();
        if (action === 'stop') await player.destroy?.();
        if (action === 'shuffle') player.queue?.shuffle?.();
        if (action === 'seek') await player.seekTo?.(num(args.value));
        if (action === 'volume') await player.setGlobalVolume?.(num(args.value, 100));
        if (action === 'loop') player.setLoop?.(str(args.value || 'track'));
        return { queue: player.queue || [] };
      }
      case 'music.filter': return { filter: str(args.name || 'none') };
      case 'music.events': return {};
      case 'test.mock': return { payload: args.payload || {} };
      case 'test.assert': {
        const actual = JSON.stringify(args.actual);
        const expected = JSON.stringify(args.expected);
        if (actual !== expected) throw new Error(`${str(args.message || 'assertion')} failed: expected ${expected}, got ${actual}`);
        return {};
      }
      default:
        throw new Error(`Flow runtime has no operation "${name}"`);
    }
  }

  function channelType(value, d) {
    const text = str(value || 'text').toLowerCase();
    const types = d.ChannelType || {};
    if (text === 'voice') return types.GuildVoice ?? 2;
    if (text === 'category') return types.GuildCategory ?? 4;
    if (text === 'forum') return types.GuildForum ?? 15;
    return types.GuildText ?? 0;
  }

  return {
    op,
    variables,
    globals,
    functions,
    cooldowns,
    caches,
    db,
    music,
    project,
    client,
  };
}
