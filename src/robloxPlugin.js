import fs from 'node:fs';

const pluginSource = fs.readFileSync(new URL('../plugin/CascadePlugin.luau', import.meta.url), 'utf8');

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Roblox accepts a local plugin as a .rbxmx model placed in the Plugins
 * folder. This is a real Script item, not a mock: Studio compiles the Luau
 * source on install and exposes the Cascade toolbar button.
 */
export function buildPluginModel() {
  return `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Script" referent="CascadePlugin">
    <Properties>
      <string name="Name">CascadePlugin</string>
      <bool name="Archivable">true</bool>
      <bool name="Disabled">false</bool>
      <ProtectedString name="Source">${xmlEscape(pluginSource)}</ProtectedString>
    </Properties>
  </Item>
</roblox>
`;
}

export function pluginDownloadName() {
  return 'CascadePlugin.rbxmx';
}

export { pluginSource };
