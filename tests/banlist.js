// Run from the repository root with: gjs tests/banlist.js
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
for (const browser of ["firefox", "chrome"]) {
  const [, bytes] = GLib.file_get_contents(`fchat-highlighter-${browser}/content.js`);
  const source = ByteArray.toString(bytes);
  new Function(source); // Parse the entire content script without running the page UI.
  const names = source.slice(source.indexOf("  function fhlCanonicalName"), source.indexOf("  function fhlAdminNoteUrl"));
  const parser = source.slice(source.indexOf("  function fhlParseBanlist"), source.indexOf("  async function fhlCompareCharacters"));
  const parse = new Function(names + parser + "; return fhlParseBanlist;")();
  const cases = [
    ['[21:41] Channel bans for Example: Alice, Bob', ['Alice', 'Bob']],
    ['Channel bans for Example: Alice, Bob', ['Alice', 'Bob']],
    ['Alice, Bob', ['Alice', 'Bob']],
    [' Alice, "alice", "Bob", , Bob, ', ['Alice', 'Bob']],
    ['lion_cub, 00 - ace, "luka the monk"', ['lion_cub', '00 - ace', 'luka the monk']],
    ['', []],
    ['[21:41] Channel bans for Example: , ,', []]
  ];
  for (const [input, expected] of cases) {
    assert(JSON.stringify(parse(input).map(item => item.name)) === JSON.stringify(expected), `${browser}: parsing ${input}`);
  }
  const comparisonStart = source.indexOf("    const ignoredByName =");
  const comparisonEnd = source.indexOf("    return matches;", comparisonStart) + "    return matches;".length;
  const compare = new Function("ignoredCharacters", "allCharacters", names + "const trace = []; function fhlTrace() {}" + source.slice(comparisonStart, comparisonEnd));
  const matches = compare(parse('ALICE, old name, alt deleted, renamed alt'), [
    { name: 'Alice', href: '/alice' },
    { name: 'Alice', renamed: true },
    { name: 'Old Name', deleted: true },
    { name: 'Alt Deleted', deleted: true, alt: true },
    { name: 'Renamed Alt', renamed: true, alt: true },
    { name: 'Unrelated' }
  ]);
  assert(matches.length === 4, `${browser}: match count`);
  assert(matches[0].renamed && matches[0].href === '/alice', `${browser}: merged labels and profile`);
  assert(matches[1].deleted, `${browser}: deleted label`);
  assert(matches[2].deleted && matches[2].alt, `${browser}: deleted alt labels`);
  assert(matches[3].renamed && matches[3].alt, `${browser}: renamed alt labels`);
  assert(compare(parse('Nobody'), [{ name: 'Alice' }]).length === 0, `${browser}: no matches`);
  print(`${browser}: syntax, banlist parsing, matching, and labels passed`);
}
