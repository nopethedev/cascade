/* Cascade Flow node registry — shared by the canvas, compiler and tests.
   A node definition describes its typed pins, inspector fields and the
   runtime operation the compiler emits. Keep this file browser-safe. */

const EXEC = 'exec';
const T = {
  any: 'any', string: 'string', number: 'number', boolean: 'boolean', json: 'json',
  interaction: 'Interaction', message: 'Message', user: 'User', member: 'GuildMember',
  channel: 'Channel', guild: 'Guild', role: 'Role', modal: 'Modal', embed: 'Embed',
  component: 'Component', client: 'Client', voice: 'VoiceState', thread: 'Thread',
  function: 'Function',
};

const COLORS = {
  Events: '#38bdf8',
  Commands: '#f472b6',
  Messages: '#a78bfa',
  Components: '#22d3ee',
  Guild: '#f59e0b',
  Logic: '#e11d48',
  Data: '#84cc16',
  Database: '#14b8a6',
  AI: '#c084fc',
  HTTP: '#fb923c',
  Music: '#06b6d4',
  Scripts: '#eab308',
  Runtime: '#94a3b8',
  Testing: '#64748b',
};

const pin = (id, label, type = 'any', extra = {}) => ({ id, label, type, kind: 'data', ...extra });
const exec = (id, label = '') => ({ id, label, type: EXEC, kind: 'exec' });
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

function node(type, title, category, operation, options = {}) {
  return {
    type,
    title,
    category,
    color: options.color || COLORS[category] || '#64748b',
    icon: options.icon || title.slice(0, 2).toUpperCase(),
    description: options.description || '',
    operation,
    inputs: options.inputs || [],
    outputs: options.outputs || [exec('next')],
    fields: options.fields || [],
    special: options.special || null,
    width: options.width || 220,
    source: options.source || null,
  };
}

const entry = (type, title, category, extraOutputs, description) => node(type, title, category, 'entry', {
  special: 'entry',
  icon: 'EV',
  description,
  inputs: [],
  outputs: [exec('next'), ...extraOutputs],
});

const action = (type, title, category, operation, inputs, fields = [], options = {}) => {
  const outputs = options.outputs ? [exec('next'), ...options.outputs] : undefined;
  return node(type, title, category, operation, {
    inputs: [exec('exec'), ...inputs],
    outputs: [exec('next'), ...(options.outputs || [])],
    fields,
    ...options,
    ...(outputs ? { outputs } : {}),
  });
};

const dataNode = (type, title, category, operation, outputs, fields = [], description = '') => node(type, title, category, operation, {
  inputs: [], outputs, fields, description, special: 'data',
});

export const NODE_LIBRARY = [
  // ------------------------------------------------------------------ events
  entry('event-ready', 'Ready', 'Events', [pin('client', 'Client', 'Client')], 'Runs once when the gateway client becomes ready.'),
  entry('event-message', 'Message Create', 'Events', [
    pin('message', 'Message', 'Message'), pin('author', 'Author', 'User'), pin('channel', 'Channel', 'Channel'),
    pin('guild', 'Guild', 'Guild'), pin('content', 'Content', 'string'),
  ], 'Runs for every message the bot can see. Requires MessageContent for content access.'),
  entry('event-interaction', 'Interaction Create', 'Events', [
    pin('interaction', 'Interaction', 'Interaction'), pin('user', 'User', 'User'), pin('channel', 'Channel', 'Channel'),
    pin('guild', 'Guild', 'Guild'), pin('commandName', 'Command name', 'string'),
  ], 'Runs for slash commands, context menus, buttons, selects and modals.'),
  entry('event-member-join', 'Member Join', 'Events', [pin('member', 'Member', 'GuildMember'), pin('user', 'User', 'User'), pin('guild', 'Guild', 'Guild')], 'Runs when a member joins a guild. GuildMembers intent required.'),
  entry('event-member-leave', 'Member Leave', 'Events', [pin('member', 'Member', 'GuildMember'), pin('user', 'User', 'User'), pin('guild', 'Guild', 'Guild')], 'Runs when a member leaves or is removed.'),
  entry('event-voice', 'Voice State Update', 'Events', [pin('oldState', 'Old state', 'VoiceState'), pin('newState', 'New state', 'VoiceState'), pin('member', 'Member', 'GuildMember'), pin('guild', 'Guild', 'Guild')], 'Runs when a member joins, leaves or moves voice channel.'),
  entry('event-reaction', 'Reaction Add', 'Events', [pin('reaction', 'Reaction', 'any'), pin('user', 'User', 'User'), pin('message', 'Message', 'Message')], 'Runs when a reaction is added.'),
  entry('event-guild', 'Guild Create', 'Events', [pin('guild', 'Guild', 'Guild')], 'Runs when the bot joins a guild.'),
  entry('event-channel', 'Channel Create', 'Events', [pin('channel', 'Channel', 'Channel')], 'Runs when a channel is created.'),
  entry('event-thread', 'Thread Create', 'Events', [pin('thread', 'Thread', 'Thread')], 'Runs when a thread is created.'),
  entry('event-role', 'Role Create', 'Events', [pin('role', 'Role', 'Role')], 'Runs when a role is created.'),
  entry('event-client-error', 'Client Error', 'Events', [pin('error', 'Error', 'any')], 'Runs when discord.js emits an error.'),
  entry('event-message-update', 'Message Update', 'Events', [pin('oldMessage', 'Old message', 'Message'), pin('newMessage', 'New message', 'Message'), pin('message', 'Message', 'Message'), pin('channel', 'Channel', 'Channel'), pin('guild', 'Guild', 'Guild')], 'Runs when a cached message is edited.'),
  entry('event-message-delete', 'Message Delete', 'Events', [pin('message', 'Message', 'Message'), pin('channel', 'Channel', 'Channel'), pin('guild', 'Guild', 'Guild')], 'Runs when a message is deleted.'),
  entry('event-member-update', 'Member Update', 'Events', [pin('oldMember', 'Old member', 'GuildMember'), pin('newMember', 'New member', 'GuildMember'), pin('member', 'Member', 'GuildMember'), pin('guild', 'Guild', 'Guild')], 'Runs when a member changes nickname or roles.'),
  entry('event-ban-add', 'Member Banned', 'Events', [pin('guild', 'Guild', 'Guild'), pin('user', 'User', 'User')], 'Runs when a guild member is banned.'),
  entry('event-presence', 'Presence Update', 'Events', [pin('oldPresence', 'Old presence', 'any'), pin('newPresence', 'New presence', 'any'), pin('member', 'Member', 'GuildMember'), pin('guild', 'Guild', 'Guild')], 'Runs when a member presence changes. Presence intent required.'),
  entry('event-reaction-remove', 'Reaction Remove', 'Events', [pin('reaction', 'Reaction', 'any'), pin('user', 'User', 'User'), pin('message', 'Message', 'Message')], 'Runs when a reaction is removed.'),
  entry('event-channel-delete', 'Channel Delete', 'Events', [pin('channel', 'Channel', 'Channel'), pin('guild', 'Guild', 'Guild')], 'Runs when a channel is deleted.'),
  entry('event-role-delete', 'Role Delete', 'Events', [pin('role', 'Role', 'Role'), pin('guild', 'Guild', 'Guild')], 'Runs when a role is deleted.'),
  entry('event-thread-delete', 'Thread Delete', 'Events', [pin('thread', 'Thread', 'Thread'), pin('guild', 'Guild', 'Guild')], 'Runs when a thread is deleted.'),
  entry('event-invite-create', 'Invite Create', 'Events', [pin('invite', 'Invite', 'any'), pin('channel', 'Channel', 'Channel'), pin('guild', 'Guild', 'Guild')], 'Runs when an invite is created.'),
  entry('event-generic', 'Any Gateway Event', 'Events', [pin('payload', 'Payload', 'json')], 'Escape hatch for a discord.js gateway event.'),
  node('command-entry', 'Slash / Command Entry', 'Commands', 'entry', {
    special: 'entry', icon: 'CMD', description: 'Entry point for the command described in the script settings.',
    inputs: [],
    outputs: [exec('next'), pin('interaction', 'Interaction', 'Interaction'), pin('user', 'User', 'User'),
      pin('channel', 'Channel', 'Channel'), pin('guild', 'Guild', 'Guild'), pin('member', 'Member', 'GuildMember'),
      pin('options', 'Options', 'json'), pin('args', 'Raw args', 'json')],
  }),
  node('main-entry', 'On Bot Ready', 'Runtime', 'entry', {
    special: 'entry', icon: 'RUN', description: 'Entry point for a main/module script. Runs after the client is ready.',
    inputs: [], outputs: [exec('next'), pin('client', 'Client', 'Client')],
  }),

  // --------------------------------------------------------------- lifecycle
  action('client-create', 'Create Discord Client', 'Runtime', 'client.create', [], [
    field('intents', 'Gateway intents', 'json', { rows: 3, help: 'JSON array. Privileged intents need Discord approval.' }),
    field('partials', 'Partials', 'json', { rows: 2 }),
    field('restVersion', 'REST version', 'text', { default: '10' }),
  ], { outputs: [pin('client', 'Client', 'Client')], icon: 'CL' }),
  action('client-login', 'Login', 'Runtime', 'client.login', [], [field('tokenEnv', 'Token env var', 'text', { default: 'DISCORD_TOKEN' })], { icon: 'IN' }),
  action('client-destroy', 'Shutdown', 'Runtime', 'client.destroy', [], [], { icon: 'X' }),
  action('presence-set', 'Set Presence', 'Runtime', 'presence.set', [pin('text', 'Activity text', 'string')], [
    field('activityType', 'Activity type', 'select', { options: ['Playing', 'Watching', 'Listening', 'Competing', 'Custom'], default: 'Playing' }),
    field('status', 'Status', 'select', { options: ['online', 'idle', 'dnd', 'invisible'], default: 'online' }),
    field('url', 'Stream URL', 'text', { placeholder: 'https://twitch.tv/…' }),
  ], { icon: 'PR' }),
  action('presence-rotate', 'Rotate Activities', 'Runtime', 'presence.rotate', [], [
    field('activities', 'Activities (one per line)', 'textarea', { rows: 4, default: 'Playing with Cascade Flow\nWatching the community' }),
    field('intervalSeconds', 'Interval (seconds)', 'number', { default: 30, min: 10 }),
  ], { icon: 'RO' }),
  action('intents-config', 'Intent Configuration', 'Runtime', 'config.note', [], [
    field('intents', 'Intents', 'json', { default: ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers', 'GuildVoiceStates'] }),
    field('privilegedApproved', 'Privileged intents approved', 'checkbox', { default: false, help: 'Discord requires approval for MessageContent, GuildMembers and Presence.' }),
  ], { icon: 'GW' }),
  action('error-handler', 'Handle Error', 'Runtime', 'error.handle', [pin('error', 'Error', 'any')], [
    field('log', 'Log to console', 'checkbox', { default: true }),
    field('reply', 'Reply to interaction', 'checkbox', { default: false }),
  ], { icon: '!' }),

  // ----------------------------------------------------------------- commands
  action('command-respond', 'Reply to Interaction', 'Commands', 'discord.interaction.reply',
    [pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [
      field('ephemeral', 'Ephemeral', 'checkbox', { default: false }),
      field('mode', 'Response mode', 'select', { options: ['reply', 'followUp', 'editReply'], default: 'reply' }),
      field('tts', 'Text to speech', 'checkbox', { default: false }),
    ], { icon: 'RE' }),
  action('command-defer', 'Defer Reply', 'Commands', 'discord.interaction.defer', [], [
    field('ephemeral', 'Ephemeral', 'checkbox', { default: false }),
    field('mode', 'Mode', 'select', { options: ['deferReply', 'deferUpdate'], default: 'deferReply' }),
  ], { icon: 'DF' }),
  action('command-followup', 'Follow-up', 'Commands', 'discord.interaction.followUp',
    [pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [
      field('ephemeral', 'Ephemeral', 'checkbox', { default: false }),
    ], { icon: 'FU' }),
  action('command-edit', 'Edit Reply', 'Commands', 'discord.interaction.editReply',
    [pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [], { icon: 'ED' }),
  action('autocomplete-respond', 'Respond to Autocomplete', 'Commands', 'discord.interaction.autocomplete',
    [pin('choices', 'Choices', 'json')], [], { icon: 'AC' }),
  action('command-register', 'Register Commands', 'Commands', 'discord.commands.register', [], [
    field('scope', 'Scope', 'select', { options: ['global', 'guild'], default: 'guild' }),
    field('guildIdEnv', 'Guild id env var', 'text', { default: 'GUILD_ID' }),
    field('clear', 'Clear before registering', 'checkbox', { default: false }),
  ], { icon: 'RG' }),
  node('command-option', 'Get Command Option', 'Commands', 'command.option', {
    special: 'data', icon: 'OP', inputs: [],
    outputs: [pin('value', 'Value', 'any')],
    fields: [field('name', 'Option name', 'text', { default: 'query', required: true }), field('fallback', 'Fallback', 'json', { default: null })],
  }),
  node('command-permission', 'Permission Check', 'Commands', 'command.permission', {
    special: 'branch', icon: 'PM',
    inputs: [exec('exec'), pin('permission', 'Permission', 'string')],
    outputs: [exec('allowed', 'Allowed'), exec('denied', 'Denied')],
    fields: [field('permission', 'Permission flag', 'text', { default: 'ManageGuild' }), field('requireAll', 'Require all permissions', 'checkbox', { default: true })],
  }),
  node('command-cooldown', 'Cooldown Check', 'Commands', 'command.cooldown', {
    special: 'branch', icon: 'CD',
    inputs: [exec('exec')],
    outputs: [exec('allowed', 'Ready'), exec('cooldown', 'On cooldown'), pin('remaining', 'Remaining seconds', 'number')],
    fields: [field('seconds', 'Seconds', 'number', { default: 5, min: 0 }), field('key', 'Bucket key', 'text', { default: 'user' }),
      field('scope', 'Scope', 'select', { options: ['user', 'guild', 'global'], default: 'user' })],
  }),

  // ----------------------------------------------------------------- messages
  action('message-reply', 'Reply to Message', 'Messages', 'discord.message.reply',
    [pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [
      field('mention', 'Mention author', 'checkbox', { default: true }),
    ], { icon: 'RP' }),
  action('message-send', 'Send Message', 'Messages', 'discord.message.send',
    [pin('channel', 'Channel', 'Channel'), pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [], { icon: 'SM' }),
  action('message-edit', 'Edit Message', 'Messages', 'discord.message.edit',
    [pin('message', 'Message', 'Message'), pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json')], [], { icon: 'ME' }),
  action('message-delete', 'Delete Message', 'Messages', 'discord.message.delete',
    [pin('message', 'Message', 'Message')], [field('reason', 'Reason', 'text')], { icon: 'DL' }),
  action('message-fetch', 'Fetch Message', 'Messages', 'discord.message.fetch',
    [pin('channel', 'Channel', 'Channel'), pin('messageId', 'Message id', 'string')], [], { outputs: [pin('message', 'Message', 'Message')], icon: 'FE' }),
  action('message-history', 'Fetch History', 'Messages', 'discord.message.history',
    [pin('channel', 'Channel', 'Channel')], [field('limit', 'Limit', 'number', { default: 20, min: 1 })], { outputs: [pin('messages', 'Messages', 'json')], icon: 'HI' }),
  action('message-collect', 'Await Messages', 'Messages', 'discord.message.collect',
    [pin('channel', 'Channel', 'Channel')], [field('filter', 'Filter', 'select', { options: ['same-author', 'any'], default: 'same-author' }), field('timeSeconds', 'Timeout (seconds)', 'number', { default: 30, min: 1 })], { outputs: [pin('message', 'Message', 'Message')], icon: 'CO' }),
  action('message-react', 'React to Message', 'Messages', 'discord.message.react',
    [pin('message', 'Message', 'Message'), pin('emoji', 'Emoji', 'string')], [], { icon: 'RX' }),
  action('message-pin', 'Pin Message', 'Messages', 'discord.message.pin',
    [pin('message', 'Message', 'Message')], [], { icon: 'PI' }),
  action('message-schedule', 'Schedule Message', 'Messages', 'discord.message.schedule',
    [pin('channel', 'Channel', 'Channel'), pin('content', 'Content', 'string')], [field('delaySeconds', 'Delay (seconds)', 'number', { default: 60, min: 1 })], { icon: 'SC' }),
  action('poll-create', 'Create Poll', 'Messages', 'discord.poll.create',
    [pin('channel', 'Channel', 'Channel')], [field('question', 'Question', 'text', { default: 'Vote below' }), field('answers', 'Answers (one per line)', 'textarea', { default: 'Yes\nNo' }), field('durationHours', 'Duration (hours)', 'number', { default: 24 }), field('multiple', 'Allow multiple', 'checkbox', { default: false })], { outputs: [pin('message', 'Message', 'Message')], icon: 'PO' }),

  // --------------------------------------------------------------- components
  node('embed-create', 'Create Embed', 'Components', 'embed.create', {
    special: 'data', icon: 'EM', inputs: [pin('title', 'Title', 'string'), pin('description', 'Description', 'string')],
    outputs: [pin('embed', 'Embed', 'Embed')],
    fields: [field('title', 'Title', 'text'), field('description', 'Description', 'textarea', { rows: 3 }),
      field('color', 'Colour', 'color', { default: '#e11d48' }), field('url', 'URL', 'text'),
      field('image', 'Image URL', 'text'), field('thumbnail', 'Thumbnail URL', 'text'),
      field('footer', 'Footer', 'text'), field('fields', 'Fields', 'json', { rows: 3, default: [] })],
  }),
  node('embed-field', 'Embed Field', 'Components', 'embed.field', {
    special: 'data', icon: 'EF', inputs: [],
    outputs: [pin('field', 'Field', 'json')],
    fields: [field('name', 'Name', 'text'), field('value', 'Value', 'text'), field('inline', 'Inline', 'checkbox', { default: false })],
  }),
  node('component-button', 'Button', 'Components', 'component.button', {
    special: 'data', icon: 'BT', inputs: [],
    outputs: [pin('component', 'Button', 'Component')],
    fields: [field('label', 'Label', 'text', { default: 'Click me' }), field('style', 'Style', 'select', { options: ['Primary', 'Secondary', 'Success', 'Danger', 'Link'], default: 'Primary' }),
      field('customId', 'Custom id / URL', 'text', { default: 'flow_button' }), field('emoji', 'Emoji', 'text'), field('disabled', 'Disabled', 'checkbox', { default: false })],
  }),
  node('component-select', 'Select Menu', 'Components', 'component.select', {
    special: 'data', icon: 'SL', inputs: [],
    outputs: [pin('component', 'Select', 'Component')],
    fields: [field('kind', 'Kind', 'select', { options: ['String', 'User', 'Role', 'Channel', 'Mentionable'], default: 'String' }),
      field('customId', 'Custom id', 'text', { default: 'flow_select' }), field('placeholder', 'Placeholder', 'text'),
      field('options', 'Options', 'json', { rows: 3, default: [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }] }),
      field('minValues', 'Min values', 'number', { default: 1 }), field('maxValues', 'Max values', 'number', { default: 1 })],
  }),
  node('component-row', 'Action Row', 'Components', 'component.row', {
    special: 'data', icon: 'AR', inputs: [pin('components', 'Components', 'json')],
    outputs: [pin('row', 'Row', 'Component')], fields: [],
  }),
  node('modal-create', 'Create Modal', 'Components', 'modal.create', {
    special: 'data', icon: 'MD', inputs: [],
    outputs: [pin('modal', 'Modal', 'Modal')],
    fields: [field('title', 'Title', 'text', { default: 'Modal title' }), field('customId', 'Custom id', 'text', { default: 'flow_modal' }),
      field('inputs', 'Inputs', 'json', { rows: 3, default: [{ label: 'Your answer', customId: 'answer', style: 'Short' }] })],
  }),
  action('modal-show', 'Show Modal', 'Components', 'discord.modal.show', [pin('modal', 'Modal', 'Modal')], [], { icon: 'SH' }),
  action('component-update', 'Update Component Message', 'Components', 'discord.component.update',
    [pin('content', 'Content', 'string'), pin('embeds', 'Embeds', 'json'), pin('components', 'Components', 'json')], [], { icon: 'UP' }),
  action('component-collect', 'Await Component', 'Components', 'discord.component.collect',
    [pin('message', 'Message', 'Message')], [field('filter', 'Custom id', 'text'), field('timeSeconds', 'Timeout (seconds)', 'number', { default: 60 })],
    { outputs: [pin('interaction', 'Interaction', 'Interaction')], icon: 'CW' }),

  // -------------------------------------------------------------------- guild
  action('guild-info', 'Guild Info', 'Guild', 'discord.guild.info', [pin('guild', 'Guild', 'Guild')], [], {
    outputs: [pin('name', 'Name', 'string'), pin('memberCount', 'Member count', 'number'), pin('ownerId', 'Owner id', 'string'), pin('createdAt', 'Created', 'string')], icon: 'GI',
  }),
  action('member-info', 'Member Info', 'Guild', 'discord.member.info', [pin('member', 'Member', 'GuildMember')], [], {
    outputs: [pin('displayName', 'Display name', 'string'), pin('joinedAt', 'Joined', 'string'), pin('roles', 'Roles', 'json'), pin('isOwner', 'Owner', 'boolean')], icon: 'MI',
  }),
  action('user-info', 'User Info', 'Guild', 'discord.user.info', [pin('user', 'User', 'User')], [], {
    outputs: [pin('username', 'Username', 'string'), pin('id', 'Id', 'string'), pin('bot', 'Is bot', 'boolean'), pin('createdAt', 'Created', 'string')], icon: 'UI',
  }),
  action('member-kick', 'Kick Member', 'Guild', 'discord.member.kick', [pin('member', 'Member', 'GuildMember')], [field('reason', 'Reason', 'text')], { icon: 'KK' }),
  action('member-ban', 'Ban Member', 'Guild', 'discord.member.ban', [pin('member', 'Member', 'GuildMember')], [field('reason', 'Reason', 'text'), field('deleteDays', 'Delete messages (days)', 'number', { default: 0, min: 0, max: 7 })], { icon: 'BN' }),
  action('member-timeout', 'Timeout Member', 'Guild', 'discord.member.timeout', [pin('member', 'Member', 'GuildMember')], [field('minutes', 'Minutes', 'number', { default: 10, min: 1 })], { icon: 'TO' }),
  action('role-add', 'Add Role', 'Guild', 'discord.role.add', [pin('member', 'Member', 'GuildMember'), pin('role', 'Role', 'Role')], [], { icon: 'R+' }),
  action('role-remove', 'Remove Role', 'Guild', 'discord.role.remove', [pin('member', 'Member', 'GuildMember'), pin('role', 'Role', 'Role')], [], { icon: 'R-' }),
  action('role-create', 'Create Role', 'Guild', 'discord.role.create', [pin('guild', 'Guild', 'Guild')], [field('name', 'Name', 'text', { default: 'New role' }), field('color', 'Colour', 'color', { default: '#6366f1' }), field('permissions', 'Permissions', 'json', { default: [] })], { outputs: [pin('role', 'Role', 'Role')], icon: 'RC' }),
  action('channel-create', 'Create Channel', 'Guild', 'discord.channel.create', [pin('guild', 'Guild', 'Guild')], [field('name', 'Name', 'text', { default: 'new-channel' }), field('type', 'Type', 'select', { options: ['text', 'voice', 'category', 'forum'], default: 'text' }), field('parentId', 'Parent category id', 'text')], { outputs: [pin('channel', 'Channel', 'Channel')], icon: 'C+' }),
  action('channel-delete', 'Delete Channel', 'Guild', 'discord.channel.delete', [pin('channel', 'Channel', 'Channel')], [], { icon: 'C-' }),
  action('thread-create', 'Create Thread', 'Guild', 'discord.thread.create', [pin('channel', 'Channel', 'Channel')], [field('name', 'Name', 'text', { default: 'Thread' }), field('private', 'Private', 'checkbox', { default: false })], { outputs: [pin('thread', 'Thread', 'Thread')], icon: 'TH' }),
  action('invite-create', 'Create Invite', 'Guild', 'discord.invite.create', [pin('channel', 'Channel', 'Channel')], [field('maxAge', 'Max age (seconds)', 'number', { default: 86400 }), field('maxUses', 'Max uses', 'number', { default: 0 }), field('unique', 'Unique', 'checkbox', { default: true })], { outputs: [pin('url', 'URL', 'string')], icon: 'IV' }),
  action('audit-log', 'Fetch Audit Logs', 'Guild', 'discord.audit.logs', [pin('guild', 'Guild', 'Guild')], [field('limit', 'Limit', 'number', { default: 10 })], { outputs: [pin('entries', 'Entries', 'json')], icon: 'AL' }),
  action('welcome-send', 'Welcome Message', 'Guild', 'discord.welcome', [pin('member', 'Member', 'GuildMember')], [field('message', 'Message', 'textarea', { default: 'Welcome {user} to {guild}!' }), field('channelId', 'Channel env / id', 'text', { default: 'WELCOME_CHANNEL_ID' })], { icon: 'WC' }),
  action('reaction-role', 'Reaction Role', 'Guild', 'discord.reactionRole', [pin('reaction', 'Reaction', 'any'), pin('user', 'User', 'User')], [field('emoji', 'Emoji', 'text'), field('roleId', 'Role id', 'text')], { icon: 'RR' }),
  action('ticket-create', 'Create Ticket', 'Guild', 'discord.ticket.create', [pin('interaction', 'Interaction', 'Interaction')], [field('categoryId', 'Category id', 'text'), field('staffRoleId', 'Staff role id', 'text'), field('welcome', 'Welcome text', 'text', { default: 'A staff member will be with you shortly.' })], { outputs: [pin('channel', 'Channel', 'Channel')], icon: 'TK' }),
  action('permissions-check', 'Check Permissions', 'Guild', 'discord.permissions.check', [pin('member', 'Member', 'GuildMember'), pin('permission', 'Permission', 'string')], [], { outputs: [pin('allowed', 'Allowed', 'boolean')], icon: 'PC' }),
  action('voice-join', 'Join Voice Channel', 'Guild', 'music.join', [pin('channel', 'Voice channel', 'Channel')], [], { icon: 'VJ' }),
  action('voice-leave', 'Leave Voice Channel', 'Guild', 'music.leave', [], [], { icon: 'VL' }),

  // -------------------------------------------------------------------- logic
  node('branch', 'Branch (If)', 'Logic', 'logic.branch', {
    special: 'branch', icon: 'IF',
    inputs: [exec('exec'), pin('condition', 'Condition', 'boolean')],
    outputs: [exec('true', 'True'), exec('false', 'False')],
    fields: [field('condition', 'Condition', 'checkbox', { default: true, help: 'Used when no data pin is connected.' })],
  }),
  node('switch', 'Switch', 'Logic', 'logic.switch', {
    special: 'switch', icon: 'SW',
    inputs: [exec('exec'), pin('value', 'Value', 'any')],
    outputs: [exec('case1', 'Case 1'), exec('case2', 'Case 2'), exec('case3', 'Case 3'), exec('default', 'Default')],
    fields: [field('case1', 'Case 1 value', 'text'), field('case2', 'Case 2 value', 'text'), field('case3', 'Case 3 value', 'text')],
  }),
  node('loop-each', 'For Each', 'Logic', 'logic.loop', {
    special: 'loop', icon: 'LO',
    inputs: [exec('exec'), pin('items', 'Items', 'json')],
    outputs: [exec('body', 'For each'), exec('done', 'Completed'), pin('item', 'Item', 'any'), pin('index', 'Index', 'number')],
    fields: [field('limit', 'Max iterations', 'number', { default: 10000, min: 1 })],
  }),
  node('while-loop', 'While', 'Logic', 'logic.while', {
    special: 'loop', icon: 'WH',
    inputs: [exec('exec'), pin('condition', 'Condition', 'boolean')],
    outputs: [exec('body', 'Body'), exec('done', 'Done')],
    fields: [field('maxIterations', 'Max iterations', 'number', { default: 10000, min: 1 })],
  }),
  action('delay', 'Delay', 'Logic', 'logic.delay', [pin('ms', 'Milliseconds', 'number')], [field('ms', 'Milliseconds', 'number', { default: 1000, min: 0 })], { icon: 'DL' }),
  node('try-catch', 'Try / Catch', 'Logic', 'logic.try', {
    special: 'try', icon: 'TC', inputs: [exec('exec')],
    outputs: [exec('body', 'Try'), exec('catch', 'Catch')], fields: [],
  }),
  node('try-end', 'End Try', 'Logic', 'logic.tryEnd', {
    special: 'tryEnd', icon: 'TE', inputs: [exec('exec')], outputs: [exec('next')], fields: [],
  }),
  action('return', 'Return', 'Logic', 'logic.return', [pin('value', 'Value', 'any')], [], { icon: 'RT', outputs: [] }),
  node('reroute', 'Reroute', 'Logic', 'logic.reroute', { icon: '>', inputs: [exec('exec')], outputs: [exec('next')], fields: [], width: 92 }),
  node('comment', 'Comment', 'Logic', 'logic.comment', {
    icon: '//', special: 'comment', inputs: [], outputs: [], width: 300,
    fields: [field('text', 'Comment', 'textarea', { rows: 4, default: 'Explain this part of the graph…' })],
  }),
  node('group', 'Group Frame', 'Logic', 'logic.group', {
    icon: '[]', special: 'group', inputs: [], outputs: [], width: 440,
    fields: [field('title', 'Group title', 'text', { default: 'Group' }), field('width', 'Width', 'number', { default: 440 }), field('height', 'Height', 'number', { default: 280 })],
  }),
  node('breakpoint', 'Breakpoint', 'Logic', 'logic.breakpoint', {
    icon: 'BP', inputs: [exec('exec')], outputs: [exec('next')],
    fields: [field('label', 'Label', 'text', { default: 'Pause here' }), field('enabled', 'Enabled', 'checkbox', { default: true })],
  }),
  action('log', 'Console Log', 'Logic', 'logic.log', [pin('message', 'Message', 'any'), pin('value', 'Value', 'any')], [], { icon: 'LG' }),
  action('assert', 'Assert', 'Logic', 'logic.assert', [pin('condition', 'Condition', 'boolean'), pin('message', 'Message', 'string')], [field('message', 'Message', 'text', { default: 'Assertion failed' })], { icon: 'AS' }),
  action('function-define', 'Define Function', 'Logic', 'script.defineFunction', [pin('args', 'Arguments', 'json')], [
    field('name', 'Function name', 'text', { default: 'myFunction', required: true }),
    field('params', 'Parameters (comma separated)', 'text', { default: 'input' }),
    field('body', 'Async JS body', 'textarea', { rows: 7, default: 'return { value: input };', code: true }),
    field('returnType', 'Return type', 'select', { options: ['any', 'string', 'number', 'boolean', 'json'], default: 'any' }),
  ], { outputs: [pin('function', 'Function', 'Function')], icon: 'FN' }),
  node('function-call', 'Call Function', 'Logic', 'script.callFunction', {
    special: 'data', icon: 'FC', inputs: [pin('args', 'Arguments', 'json')],
    outputs: [pin('result', 'Result', 'any')],
    fields: [field('name', 'Function name', 'text', { default: 'myFunction', required: true })],
  }),
  node('custom-code', 'Custom JavaScript', 'Logic', 'script.custom', {
    special: 'data', icon: 'JS', inputs: [pin('args', 'Arguments', 'json')],
    outputs: [pin('result', 'Result', 'any')],
    fields: [
      field('language', 'Language', 'select', { options: ['javascript', 'lua'], default: 'javascript' }),
      field('code', 'Async function body', 'textarea', { rows: 9, code: true, default: 'return { result: args };', warn: 'Runs with full server access when the exported bot runs.' }),
    ],
  }),

  // --------------------------------------------------------------------- data
  dataNode('text', 'Text', 'Data', 'data.text', [pin('value', 'Value', 'string')], [field('value', 'Text', 'textarea', { rows: 2, default: 'Hello!' })], 'A UTF-8 string literal.'),
  dataNode('number', 'Number', 'Data', 'data.number', [pin('value', 'Value', 'number')], [field('value', 'Number', 'number', { default: 0 })], 'A numeric literal.'),
  dataNode('boolean', 'Boolean', 'Data', 'data.boolean', [pin('value', 'Value', 'boolean')], [field('value', 'Value', 'checkbox', { default: true })]),
  dataNode('json-value', 'JSON Value', 'Data', 'data.json', [pin('value', 'Value', 'json')], [field('value', 'JSON', 'json', { rows: 4, default: {} })]),
  dataNode('template', 'Template String', 'Data', 'data.template', [pin('value', 'Value', 'string')], [
    field('template', 'Template', 'textarea', { rows: 3, default: 'Hello {name}!', help: 'Use {variable} placeholders; data inputs are available by key.' }),
  ], 'Interpolate values into a string.'),
  dataNode('array-value', 'Array', 'Data', 'data.array', [pin('value', 'Array', 'json')], [field('items', 'Items', 'json', { rows: 3, default: ['one', 'two'] })]),
  dataNode('object-value', 'Object', 'Data', 'data.object', [pin('value', 'Object', 'json')], [field('value', 'Object', 'json', { rows: 4, default: {} })]),
  dataNode('array-op', 'Array Operation', 'Data', 'data.arrayOp', [pin('value', 'Result', 'json')], [
    field('operation', 'Operation', 'select', { options: ['push', 'map', 'filter', 'find', 'join', 'slice', 'sort', 'length', 'unique'], default: 'push' }),
    field('input', 'Array', 'json', { default: [] }), field('argument', 'Argument', 'json'),
  ]),
  dataNode('string-op', 'String Operation', 'Data', 'data.stringOp', [pin('value', 'Result', 'string')], [
    field('operation', 'Operation', 'select', { options: ['uppercase', 'lowercase', 'trim', 'split', 'replace', 'includes', 'slice', 'length'], default: 'uppercase' }),
    field('input', 'Input', 'text'), field('a', 'Find / index', 'text'), field('b', 'Replace / end', 'text'),
  ]),
  dataNode('math-op', 'Math', 'Data', 'data.math', [pin('value', 'Result', 'number')], [
    field('operation', 'Operation', 'select', { options: ['add', 'subtract', 'multiply', 'divide', 'modulo', 'power', 'round', 'min', 'max', 'abs'], default: 'add' }),
    field('a', 'A', 'number', { default: 0 }), field('b', 'B', 'number', { default: 0 }),
  ]),
  dataNode('compare', 'Compare', 'Data', 'data.compare', [pin('value', 'Result', 'boolean')], [
    field('operator', 'Operator', 'select', { options: ['==', '!=', '>', '>=', '<', '<=', 'includes', 'startsWith', 'endsWith'], default: '==' }),
    field('a', 'A', 'json'), field('b', 'B', 'json'),
  ]),
  dataNode('random', 'Random', 'Data', 'data.random', [pin('value', 'Result', 'number')], [
    field('min', 'Minimum', 'number', { default: 1 }), field('max', 'Maximum', 'number', { default: 100 }), field('integer', 'Integer', 'checkbox', { default: true }),
  ]),
  dataNode('date-op', 'Date & Time', 'Data', 'data.date', [pin('value', 'Result', 'any')], [
    field('operation', 'Operation', 'select', { options: ['now', 'format', 'add', 'difference'], default: 'now' }),
    field('input', 'Input date', 'text'), field('amount', 'Amount', 'number', { default: 0 }), field('unit', 'Unit', 'select', { options: ['minutes', 'hours', 'days'], default: 'days' }),
  ]),
  dataNode('json-op', 'JSON Parse / Stringify', 'Data', 'data.jsonOp', [pin('value', 'Result', 'any')], [
    field('operation', 'Operation', 'select', { options: ['parse', 'stringify', 'get', 'keys', 'merge'], default: 'parse' }),
    field('input', 'Input', 'json'), field('path', 'Path / key', 'text'),
  ]),
  dataNode('regex-op', 'Regex', 'Data', 'data.regex', [pin('value', 'Match', 'json')], [
    field('pattern', 'Pattern', 'text', { default: '\\w+' }), field('flags', 'Flags', 'text', { default: 'g' }),
    field('input', 'Input', 'text'), field('replacement', 'Replacement', 'text'),
  ]),
  dataNode('env', 'Environment Variable', 'Data', 'data.env', [pin('value', 'Value', 'string')], [
    field('name', 'Variable name', 'text', { default: 'MY_VARIABLE', required: true }), field('fallback', 'Fallback', 'text'),
  ], 'Secrets stay in the hosting environment, never in the graph or exports.'),
  dataNode('coalesce', 'First Non-empty', 'Data', 'data.coalesce', [pin('value', 'Value', 'any')], [field('a', 'A', 'json'), field('b', 'B', 'json'), field('c', 'C', 'json')]),
  dataNode('type-convert', 'Convert Type', 'Data', 'data.convert', [pin('value', 'Value', 'any')], [
    field('to', 'Convert to', 'select', { options: ['string', 'number', 'boolean', 'json'], default: 'string' }), field('input', 'Input', 'json'),
  ]),
  dataNode('validate', 'Validate Value', 'Data', 'data.validate', [pin('valid', 'Valid', 'boolean'), pin('value', 'Value', 'any')], [
    field('kind', 'Kind', 'select', { options: ['string', 'number', 'email', 'url', 'discordId', 'json'], default: 'string' }),
    field('minLength', 'Min length', 'number', { default: 1 }), field('input', 'Input', 'json'),
  ]),
  dataNode('cache', 'Cache', 'Data', 'data.cache', [pin('value', 'Value', 'any')], [
    field('key', 'Key', 'text', { default: 'key' }), field('ttlSeconds', 'TTL (seconds)', 'number', { default: 60 }), field('value', 'Value', 'json'),
  ]),
  dataNode('variable-get', 'Get Variable', 'Data', 'data.varGet', [pin('value', 'Value', 'any')], [
    field('name', 'Name', 'text', { default: 'myVariable', required: true }), field('scope', 'Scope', 'select', { options: ['script', 'global'], default: 'script' }),
  ]),
  node('variable-set', 'Set Variable', 'Data', 'data.varSet', {
    icon: 'V=', inputs: [exec('exec'), pin('value', 'Value', 'any')], outputs: [exec('next'), pin('value', 'Value', 'any')],
    fields: [field('name', 'Name', 'text', { default: 'myVariable', required: true }), field('scope', 'Scope', 'select', { options: ['script', 'global'], default: 'script' })],
  }),
  action('global-set', 'Set Global Variable', 'Scripts', 'data.varSet', [pin('value', 'Value', 'any')], [
    field('name', 'Exported name', 'text', { default: 'sharedValue', required: true }), field('scope', 'Scope', 'select', { options: ['global'], default: 'global' }),
  ], { icon: 'G=', outputs: [pin('value', 'Value', 'any')] }),
  dataNode('map-value', 'Map', 'Data', 'data.map', [pin('value', 'Map', 'json')], [field('entries', 'Entries (JSON object)', 'json', { rows: 4, default: {} })], 'A string-keyed map backed by a plain object.'),
  dataNode('set-value', 'Set', 'Data', 'data.set', [pin('value', 'Set', 'json')], [field('items', 'Items', 'json', { rows: 3, default: [] })], 'A unique collection of JSON values.'),
  dataNode('use-from-main', 'Use From Main', 'Scripts', 'script.useFromMain', [pin('value', 'Value', 'any')], [
    field('name', 'Exported name', 'text', { default: 'sharedValue', required: true }),
    field('kind', 'Kind', 'select', { options: ['variable', 'function', 'service'], default: 'variable' }),
    field('resultType', 'Result type', 'select', { options: ['any', 'string', 'number', 'boolean', 'json'], default: 'any' }),
  ], 'Read a variable, function or service exported by Main.'),
  dataNode('import-script', 'Import Script', 'Scripts', 'script.import', [pin('value', 'Script', 'any')], [
    field('scriptId', 'Script id', 'text', { required: true }),
  ]),

  // ----------------------------------------------------------------- database
  action('db-connect', 'Configure Database', 'Database', 'db.connect', [], [
    field('backend', 'Backend', 'select', { options: ['sqlite', 'mongodb', 'json'], default: 'sqlite' }),
    field('env', 'Connection env var', 'text', { default: 'DATABASE_URL', help: 'SQLite/Sequelize URL or MongoDB URI. Never store credentials in the project.' }),
    field('jsonPath', 'JSON file path', 'text', { default: 'data/flow-db.json' }),
  ], { icon: 'DB', outputs: [pin('database', 'Database', 'any')] }),
  action('db-schema', 'Define Model', 'Database', 'db.schema', [], [
    field('backend', 'Backend', 'select', { options: ['sqlite', 'mongodb', 'json'], default: 'sqlite' }),
    field('name', 'Model / collection', 'text', { default: 'users' }),
    field('schema', 'Schema fields', 'json', { rows: 5, default: { id: 'string', name: 'string', createdAt: 'date' } }),
    field('indexes', 'Indexes', 'json', { rows: 2, default: [] }),
  ], { icon: 'SC' }),
  action('db-set', 'Save Record', 'Database', 'db.set', [pin('collection', 'Collection', 'string'), pin('key', 'Key', 'string'), pin('value', 'Value', 'json')], [field('collection', 'Collection', 'text', { default: 'users' })], { icon: 'D+' }),
  action('db-get', 'Get Record', 'Database', 'db.get', [pin('collection', 'Collection', 'string'), pin('key', 'Key', 'string')], [field('collection', 'Collection', 'text', { default: 'users' })], { outputs: [pin('value', 'Value', 'json'), pin('found', 'Found', 'boolean')], icon: 'DG' }),
  action('db-delete', 'Delete Record', 'Database', 'db.delete', [pin('collection', 'Collection', 'string'), pin('key', 'Key', 'string')], [field('collection', 'Collection', 'text', { default: 'users' })], { outputs: [pin('deleted', 'Deleted', 'boolean')], icon: 'D-' }),
  action('db-query', 'Query Records', 'Database', 'db.query', [pin('collection', 'Collection', 'string'), pin('filter', 'Filter', 'json')], [field('collection', 'Collection', 'text', { default: 'users' }), field('limit', 'Limit', 'number', { default: 50 })], { outputs: [pin('rows', 'Rows', 'json'), pin('count', 'Count', 'number')], icon: 'DQ' }),
  action('db-aggregate', 'Aggregate', 'Database', 'db.aggregate', [pin('collection', 'Collection', 'string'), pin('pipeline', 'Pipeline', 'json')], [field('collection', 'Collection', 'text', { default: 'users' })], { outputs: [pin('rows', 'Rows', 'json')], icon: 'AG' }),
  action('db-transaction', 'Transaction', 'Database', 'db.transaction', [pin('operations', 'Operations', 'json')], [], { outputs: [pin('result', 'Result', 'json')], icon: 'TX' }),
  action('db-inspect', 'Inspect Database', 'Database', 'db.inspect', [pin('collection', 'Collection', 'string')], [field('collection', 'Collection', 'text', { default: 'users' }), field('limit', 'Limit', 'number', { default: 10 })], { outputs: [pin('rows', 'Rows', 'json')], icon: 'DI' }),

  // ----------------------------------------------------------------------- AI
  action('ai-chat', 'AI Text Generation', 'AI', 'ai.chat', [pin('prompt', 'Prompt', 'string'), pin('system', 'System', 'string'), pin('image', 'Image URL', 'string')], [
    field('model', 'Model', 'text', { default: 'gpt-4.1-mini' }), field('temperature', 'Temperature', 'number', { default: 0.7 }),
    field('maxTokens', 'Max tokens', 'number', { default: 800 }), field('memoryKey', 'Memory key', 'text'),
    field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }), field('baseUrlEnv', 'Base URL env var', 'text', { default: 'OPENAI_BASE_URL' }),
  ], { outputs: [pin('text', 'Text', 'string'), pin('usage', 'Usage', 'json')], icon: 'AI' }),
  action('ai-json', 'AI Structured JSON', 'AI', 'ai.json', [pin('prompt', 'Prompt', 'string'), pin('schema', 'Schema', 'json')], [
    field('model', 'Model', 'text', { default: 'gpt-4.1-mini' }), field('schema', 'JSON schema', 'json', { rows: 5, default: { type: 'object', properties: { answer: { type: 'string' } } } }),
    field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }),
  ], { outputs: [pin('value', 'Value', 'json')], icon: 'AJ' }),
  action('ai-tools', 'AI Tool Calling', 'AI', 'ai.tools', [pin('prompt', 'Prompt', 'string'), pin('tools', 'Tools', 'json')], [
    field('model', 'Model', 'text', { default: 'gpt-4.1-mini' }), field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }),
  ], { outputs: [pin('text', 'Text', 'string'), pin('calls', 'Tool calls', 'json')], icon: 'AT' }),
  action('ai-memory', 'Conversation Memory', 'AI', 'ai.memory', [pin('text', 'Text', 'string')], [
    field('key', 'Conversation key', 'text', { default: 'default' }), field('limit', 'Messages to keep', 'number', { default: 20 }),
  ], { outputs: [pin('messages', 'Messages', 'json')], icon: 'AM' }),
  action('ai-embed', 'Embeddings', 'AI', 'ai.embed', [pin('text', 'Text', 'string')], [
    field('model', 'Model', 'text', { default: 'text-embedding-3-small' }), field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }),
  ], { outputs: [pin('vector', 'Vector', 'json')], icon: 'AE' }),
  action('ai-image', 'Generate Image', 'AI', 'ai.image', [pin('prompt', 'Prompt', 'string')], [
    field('model', 'Model', 'text', { default: 'gpt-image-1' }), field('size', 'Size', 'select', { options: ['1024x1024', '1536x1024', '1024x1536'], default: '1024x1024' }),
    field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }),
  ], { outputs: [pin('url', 'Image URL', 'string'), pin('base64', 'Base64', 'string')], icon: 'IM' }),
  action('ai-moderation', 'Moderation', 'AI', 'ai.moderation', [pin('input', 'Input', 'string')], [
    field('model', 'Model', 'text', { default: 'omni-moderation-latest' }), field('env', 'API key env var', 'text', { default: 'OPENAI_API_KEY' }),
  ], { outputs: [pin('flagged', 'Flagged', 'boolean'), pin('categories', 'Categories', 'json')], icon: 'MO' }),

  // ----------------------------------------------------------------------- HTTP
  action('http-request', 'HTTP Request', 'HTTP', 'http.request', [pin('url', 'URL', 'string'), pin('headers', 'Headers', 'json'), pin('body', 'Body', 'json')], [
    field('method', 'Method', 'select', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' }),
    field('url', 'URL', 'text', { placeholder: 'https://api.example.com/data' }),
    field('headers', 'Headers', 'json', { rows: 2, default: {} }), field('body', 'JSON body', 'json', { rows: 3 }), field('timeoutMs', 'Timeout (ms)', 'number', { default: 10000 }),
    field('retries', 'Retries', 'number', { default: 2 }), field('authEnv', 'Bearer token env var', 'text'),
  ], { outputs: [pin('status', 'Status', 'number'), pin('ok', 'OK', 'boolean'), pin('body', 'Body', 'json'), pin('headers', 'Headers', 'json')], icon: 'HT' }),
  action('webhook-handler', 'Webhook Handler', 'HTTP', 'http.webhook', [], [field('path', 'Path', 'text', { default: '/webhook' }), field('secretEnv', 'Secret env var', 'text', { default: 'WEBHOOK_SECRET' })], { outputs: [pin('payload', 'Payload', 'json')], icon: 'WH' }),
  action('websocket-client', 'WebSocket Client', 'HTTP', 'http.websocket', [pin('url', 'URL', 'string')], [field('url', 'URL', 'text'), field('message', 'Message to send', 'text')], { outputs: [pin('message', 'Message', 'any')], icon: 'WS' }),
  action('pagination', 'Paginate API', 'HTTP', 'http.paginate', [pin('url', 'URL', 'string')], [field('itemsPath', 'Items path', 'text', { default: 'data' }), field('nextPath', 'Next cursor path', 'text', { default: 'next' }), field('maxPages', 'Max pages', 'number', { default: 10 })], { outputs: [pin('items', 'Items', 'json')], icon: 'PG' }),

  // ---------------------------------------------------------------------- music
  action('lavalink-connect', 'Connect Lavalink', 'Music', 'music.connect', [], [
    field('nodes', 'Nodes', 'json', { rows: 5, default: [{ name: 'main', url: 'localhost:2333', authEnv: 'LAVALINK_PASSWORD', secure: false }] }),
    field('clientName', 'Client name', 'text', { default: 'CascadeFlow' }), field('failover', 'Failover nodes', 'checkbox', { default: true }),
  ], { icon: 'LV', outputs: [pin('manager', 'Manager', 'any')] }),
  action('music-search', 'Search Tracks', 'Music', 'music.search', [pin('query', 'Query', 'string')], [field('source', 'Source', 'select', { options: ['youtube', 'soundcloud', 'spotify', 'ytsearch'], default: 'ytsearch' })], { outputs: [pin('tracks', 'Tracks', 'json')], icon: 'MS' }),
  action('music-play', 'Play Track', 'Music', 'music.play', [pin('track', 'Track', 'json'), pin('channel', 'Voice channel', 'Channel')], [field('queue', 'Add to queue if playing', 'checkbox', { default: true })], { icon: 'MP' }),
  action('music-queue', 'Queue Controls', 'Music', 'music.queue', [pin('action', 'Action', 'string')], [field('action', 'Action', 'select', { options: ['pause', 'resume', 'skip', 'stop', 'shuffle', 'loop', 'seek', 'volume'], default: 'skip' }), field('value', 'Value', 'number')], { outputs: [pin('queue', 'Queue', 'json')], icon: 'MQ' }),
  action('music-filter', 'Audio Filter', 'Music', 'music.filter', [pin('name', 'Filter', 'string')], [field('name', 'Filter', 'select', { options: ['none', 'bassboost', 'nightcore', 'vaporwave', 'karaoke', 'tremolo'], default: 'none' })], { icon: 'MF' }),
  action('music-events', 'Player Events', 'Music', 'music.events', [], [field('events', 'Events', 'json', { default: ['trackStart', 'trackEnd', 'queueEnd'] })], { icon: 'MV' }),

  // -------------------------------------------------------------------- testing
  action('mock-event', 'Mock Event', 'Testing', 'test.mock', [], [field('payload', 'Payload', 'json', { rows: 4, default: {} })], { outputs: [pin('payload', 'Payload', 'json')], icon: 'MK' }),
  action('test-assert', 'Test Assertion', 'Testing', 'test.assert', [pin('actual', 'Actual', 'any'), pin('expected', 'Expected', 'any')], [field('message', 'Description', 'text', { default: 'value matches' })], { icon: 'TA' }),
];

export const NODE_BY_TYPE = new Map(NODE_LIBRARY.map((n) => [n.type, n]));
export const NODE_CATEGORIES = [...new Set(NODE_LIBRARY.map((n) => n.category))];
export const PIN_TYPES = T;
export { COLORS };

export const EVENTS = {
  ready: { node: 'event-ready', discord: 'ClientReady', context: 'client' },
  messageCreate: { node: 'event-message', discord: 'MessageCreate', context: 'message' },
  interactionCreate: { node: 'event-interaction', discord: 'InteractionCreate', context: 'interaction' },
  guildMemberAdd: { node: 'event-member-join', discord: 'GuildMemberAdd', context: 'member' },
  guildMemberRemove: { node: 'event-member-leave', discord: 'GuildMemberRemove', context: 'member' },
  guildMemberUpdate: { node: 'event-member-update', discord: 'GuildMemberUpdate', context: 'newMember' },
  guildBanAdd: { node: 'event-ban-add', discord: 'GuildBanAdd', context: 'user' },
  presenceUpdate: { node: 'event-presence', discord: 'PresenceUpdate', context: 'newPresence' },
  voiceStateUpdate: { node: 'event-voice', discord: 'VoiceStateUpdate', context: 'newState' },
  messageReactionAdd: { node: 'event-reaction', discord: 'MessageReactionAdd', context: 'reaction' },
  messageReactionRemove: { node: 'event-reaction-remove', discord: 'MessageReactionRemove', context: 'reaction' },
  messageUpdate: { node: 'event-message-update', discord: 'MessageUpdate', context: 'newMessage' },
  messageDelete: { node: 'event-message-delete', discord: 'MessageDelete', context: 'message' },
  guildCreate: { node: 'event-guild', discord: 'GuildCreate', context: 'guild' },
  channelCreate: { node: 'event-channel', discord: 'ChannelCreate', context: 'channel' },
  channelDelete: { node: 'event-channel-delete', discord: 'ChannelDelete', context: 'channel' },
  threadCreate: { node: 'event-thread', discord: 'ThreadCreate', context: 'thread' },
  threadDelete: { node: 'event-thread-delete', discord: 'ThreadDelete', context: 'thread' },
  roleCreate: { node: 'event-role', discord: 'RoleCreate', context: 'role' },
  roleDelete: { node: 'event-role-delete', discord: 'RoleDelete', context: 'role' },
  inviteCreate: { node: 'event-invite-create', discord: 'InviteCreate', context: 'invite' },
  error: { node: 'event-client-error', discord: 'Error', context: 'error' },
};

export const COMMAND_TYPES = {
  slash: 'Chat Input',
  prefix: 'Prefix',
  user: 'User Context Menu',
  message: 'Message Context Menu',
};

export const CATEGORY_COLORS = COLORS;
