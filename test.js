// Self-check for script.js: drives the Shell without a browser.  Run: node test.js
const assert = require('assert');
const { Shell, COMMANDS } = require('./script.js');

// Stand-in for the Terminal: records what CLS, TITLE and COLOR ask for.
const screen = { cleared: 0, clear() { this.cleared++; }, setTitle(t) { this.title = t; }, setColor(bg, text) { this.color = [bg, text]; } };
const sh = new Shell(screen);
const run = line => sh.run(line);
const has = (line, ...needles) => { const o = run(line); for (const n of needles) assert.ok(o.includes(n), `"${line}" should print "${n}", got:\n${o}`); return o; };
const lacks = (line, needle) => { const o = run(line); assert.ok(!o.includes(needle), `"${line}" should not print "${needle}", got:\n${o}`); return o; };
const silent = line => assert.strictEqual(run(line), '', `"${line}" should print nothing`);
const DENIED = 'Access is denied.';

// ── terminal: cls, title, color, prompt ──
silent('cls'); assert.strictEqual(screen.cleared, 1);
silent('title My CMD Lab'); assert.strictEqual(screen.title, 'My CMD Lab');
silent('color 0A'); assert.deepStrictEqual(screen.color, ['#0c0c0c', '#16c60c']);
silent('color 1F'); assert.deepStrictEqual(screen.color, ['#0037da', '#f2f2f2']);
silent('color'); assert.deepStrictEqual(screen.color, ['#0c0c0c', '#cccccc']);
has('color 11', 'COLOR [attr]'); has('color zz', 'COLOR [attr]'); has('color 123', 'COLOR [attr]');
assert.deepStrictEqual(screen.color, ['#0c0c0c', '#cccccc'], 'invalid colour leaves the screen alone');
assert.strictEqual(sh.prompt, 'C:\\Users\\Student>');
silent('prompt [%USERNAME%] $P$_$$$S'); assert.strictEqual(sh.prompt, '[Student] C:\\Users\\Student\n$ ');
silent('prompt $N$L$G'); assert.strictEqual(sh.prompt, 'C<>');
silent('prompt $T $D'); assert.match(sh.prompt, /^\d\d:\d\d:\d\d \d+\/\d+\/\d{4}$/);
silent('prompt'); assert.strictEqual(sh.prompt, 'C:\\Users\\Student>');

// ── cd ──
assert.strictEqual(run('cd'), 'C:\\Users\\Student\n');
silent('cd documents'); assert.strictEqual(sh.prompt, 'C:\\Users\\Student\\Documents>', 'prompt uses the stored spelling');
silent('cd..'); silent('cd ..'); assert.strictEqual(sh.prompt, 'C:\\Users>');
silent('cd \\'); assert.strictEqual(sh.prompt, 'C:\\>');
silent('cd ..'); assert.strictEqual(sh.prompt, 'C:\\>', 'cd .. at the root stays put');
silent('cd "Program Files"'); assert.strictEqual(sh.prompt, 'C:\\Program Files>');
silent('cd\\'); silent('cd Program Files'); assert.strictEqual(sh.prompt, 'C:\\Program Files>', 'works unquoted with spaces');
silent('cd /d %USERPROFILE%'); assert.strictEqual(sh.prompt, 'C:\\Users\\Student>');
has('cd nowhere', 'The system cannot find the path specified.');
has('cd welcome.txt', 'The directory name is invalid.');

// ── mkdir / rmdir ──
silent('mkdir Lab1'); silent('mkdir Lab2 Lab3'); silent('mkdir Projects\\Web\\css'); silent('mkdir "My Folder"');
has('dir', 'Lab1', 'Lab2', 'Lab3', 'Projects', 'My Folder');
has('dir Projects\\Web', 'css');
has('mkdir Lab1', 'A subdirectory or file Lab1 already exists.');
has('mkdir bad*name', 'syntax is incorrect');
silent('rmdir Lab1'); lacks('dir', 'Lab1');
has('rmdir Projects', 'The directory is not empty.');
has('rmdir nope', 'The system cannot find the file specified.');
silent('cd Projects'); has('rmdir /s /q ..\\Projects', 'being used by another process'); silent('cd ..');
silent('rmdir /s Projects'); lacks('dir', 'Projects');
silent('mkdir Lab2\\deep'); silent('rmdir /s /q Lab2'); lacks('dir', 'Lab2');
silent('rmdir Lab3'); silent('rmdir "My Folder"');

// ── dir ──
const d = has('dir', ' Directory of C:\\Users\\Student', '<DIR>          .', '<DIR>          Documents', ' welcome.txt', '1 File(s)', 'bytes free');
assert.ok(!d.includes('AppData') && !d.includes('ntuser.ini'), 'hidden entries need /a');
assert.match(d, /^\d\d\/\d\d\/\d{4}  \d\d:\d\d [AP]M    <DIR>          Desktop$/m, 'timestamp column');
has('dir /a', 'AppData', 'ntuser.ini', '2 File(s)');
has('dir /w', '[Documents]', '[..]', 'welcome.txt');
const dt = has('dir Documents\\*.txt', ' Directory of C:\\Users\\Student\\Documents', 'notes.txt', 'fruits.txt', '5 File(s)');
assert.ok(!dt.includes('<DIR>'), 'wildcard listing has no . and ..');
has('dir *.xyz', 'File Not Found');
has('dir C:\\', 'Program Files', 'Users', 'Windows');
assert.match(run('dir Documents'), / 36 fruits\.txt/, 'sizes count CR+LF line endings');

// ── echo + redirection ──
assert.strictEqual(run('echo Hello World'), 'Hello World\n');
assert.strictEqual(run('echo'), 'ECHO is on.\n');
assert.strictEqual(run('echo.'), '\n');
silent('echo First line > demo.txt'); silent('echo Second line >> demo.txt'); silent('echo. >> demo.txt'); silent('echo last>>"demo.txt"');
assert.strictEqual(run('type demo.txt'), 'First line\nSecond line\n\nlast\n');
silent('echo over > demo.txt'); assert.strictEqual(run('type demo.txt'), 'over\n');
silent('echo. > blank.txt'); assert.strictEqual(sh.file('blank.txt').content, '\n');
assert.strictEqual(run('echo "a > b"'), '"a > b"\n', '> inside quotes is text');
has('echo x > nodir\\f.txt', 'The system cannot find the path specified.');
has('type nope.txt', 'The system cannot find the file specified.');

// ── tree ──
has('tree', 'Folder PATH listing', 'C:.', '├───Desktop', '└───Downloads');
has('tree /f', 'welcome.txt', '│       notes.txt');
has('tree /a', '+---Desktop', '\\---Downloads');
silent('tree /f /a > tree.txt');
has('type tree.txt', 'Folder PATH listing', '+---Documents', '|       notes.txt', 'tree.txt');
has('tree C:\\Windows', 'C:\\WINDOWS', '└───System32');
has('tree Desktop', 'No subfolders exist');
silent('dir > listing.txt'); has('type listing.txt', ' Directory of C:\\Users\\Student', 'listing.txt');
silent('help >> listing.txt'); has('type listing.txt', 'Directory of', 'For more information');

// ── copy / del ──
has('copy demo.txt backup.txt', '        1 file(s) copied.'); assert.strictEqual(run('type backup.txt'), 'over\n');
has('copy Documents\\*.txt Desktop', 'notes.txt', '5 file(s) copied.');
has('dir Desktop', 'notes.txt', 'report_v2.txt', '5 File(s)');
has('copy demo.txt Desktop', '1 file(s) copied.'); has('dir Desktop', 'demo.txt');
has('copy nope.txt x.txt', 'The system cannot find the file specified.');
silent('del backup.txt'); lacks('dir', 'backup.txt');
silent('del Desktop\\*.txt'); has('dir Desktop', '0 File(s)');
has('del nope.txt', 'Could Not Find nope.txt');
silent('del tree.txt listing.txt blank.txt');

// ── attrib ──
has('attrib demo.txt', 'A            C:\\Users\\Student\\demo.txt');
silent('attrib +r demo.txt'); has('attrib demo.txt', 'A    R       C:\\Users\\Student\\demo.txt');
has('del demo.txt', 'C:\\Users\\Student\\demo.txt', DENIED); has('dir', 'demo.txt');
has('echo x > demo.txt', DENIED); has('echo x >> demo.txt', DENIED); has('dir > demo.txt', DENIED);
has('copy welcome.txt demo.txt', DENIED);
assert.strictEqual(run('type demo.txt'), 'over\n', 'read-only content survived');
silent('attrib -r demo.txt'); silent('echo changed > demo.txt'); assert.strictEqual(run('type demo.txt'), 'changed\n');
silent('attrib +h demo.txt'); lacks('dir', 'demo.txt'); has('dir /a', 'demo.txt'); has('attrib demo.txt', 'A   H ');
has('attrib', 'ntuser.ini', 'welcome.txt');
silent('attrib -h demo.txt'); has('dir', 'demo.txt');
silent('del demo.txt'); lacks('dir', 'demo.txt');
has('attrib nope.txt', 'File not found - nope.txt');

// ── find ──
silent('cd Documents');
assert.strictEqual(run('find "process" notes.txt'), '\n---------- NOTES.TXT\nA process is a program in execution.\nThe kernel manages memory, processes and devices.\n');
lacks('find "WINDOWS" notes.txt', 'NTFS'); has('find /i "WINDOWS" notes.txt', 'Windows uses the NTFS file system.');
has('find /c "process" notes.txt', '---------- NOTES.TXT: 2'); has('find /i /c "THE" notes.txt', ': 3');
has('find process notes.txt', 'FIND: Parameter format not correct');
has('find "x" nope.txt', 'The system cannot find the file specified.');

// ── findstr ──
assert.strictEqual(run('findstr /i "KERNEL thread" notes.txt'), 'A thread is the smallest unit of CPU scheduling.\nThe kernel manages memory, processes and devices.\n');
assert.strictEqual(run('findstr /n "CMD" todo.txt'), '2:Practice CMD commands\n');
assert.strictEqual(run('findstr /c:"file system" notes.txt'), 'Windows uses the NTFS file system.\n');
silent('findstr /c:"system file" notes.txt');
assert.strictEqual(run('findstr "system file" notes.txt'), 'Windows uses the NTFS file system.\n', 'without /c: the words are OR-ed');
has('findstr /i /n "REPORT backup" todo.txt', '1:Finish the OS lab report', '4:Backup project files');
has('findstr "x"', 'FINDSTR: Bad command line');

// ── sort ──
assert.strictEqual(run('sort fruits.txt'), 'apple\nbanana\ncherry\ndate\nMango\n');
assert.strictEqual(run('sort /r fruits.txt'), 'Mango\ndate\ncherry\nbanana\napple\n');
silent('sort fruits.txt /o sorted.txt'); assert.strictEqual(run('type sorted.txt'), 'apple\nbanana\ncherry\ndate\nMango\n');
silent('sort /r fruits.txt > rev.txt'); assert.strictEqual(run('type rev.txt'), 'Mango\ndate\ncherry\nbanana\napple\n');
has('sort nope.txt', 'The system cannot find the file specified.');
has('sort', 'The syntax of the command is incorrect.');

// ── fc ──
assert.strictEqual(run('fc report_v1.txt report_v2.txt'),
  'Comparing files report_v1.txt and REPORT_V2.TXT\n' +
  '***** report_v1.txt\nOS Lab Report\n***** REPORT_V2.TXT\nOS LAB REPORT\n*****\n\n' +
  '***** report_v1.txt\nStatus: Draft\n***** REPORT_V2.TXT\nStatus: Final\n*****\n\n');
const fcc = has('fc /c report_v1.txt report_v2.txt', 'Status: Draft', 'Status: Final');
assert.ok(!fcc.includes('OS LAB REPORT'), '/c ignores the case-only difference');
has('fc fruits.txt sorted.txt', '***** fruits.txt');
has('fc notes.txt notes.txt', 'FC: no differences encountered');
has('fc notes.txt nope.txt', 'The system cannot find the file specified.');
has('fc notes.txt', 'FC: Insufficient number of file specifications');

// ── where ──
assert.strictEqual(run('where notes.txt'), 'C:\\Users\\Student\\Documents\\notes.txt\n');
has('where *.txt', 'fruits.txt', 'todo.txt');
has('where /R C:\\Users *.txt', 'C:\\Users\\Student\\welcome.txt', 'C:\\Users\\Student\\Documents\\todo.txt');
assert.strictEqual(run('where /R C:\\ win.ini'), 'C:\\Windows\\win.ini\n');
has('where nope.txt', 'INFO: Could not find files for the given pattern(s).');
has('where /R nodir x', 'ERROR: Invalid syntax');
silent('del sorted.txt rev.txt'); silent('cd ..');

// ── variables + system ──
has('set', 'USERNAME=Student', 'USERPROFILE=C:\\Users\\Student', 'PATH=C:\\Windows\\System32');
assert.strictEqual(run('echo %USERNAME%'), 'Student\n');
assert.strictEqual(run('echo %userprofile%'), 'C:\\Users\\Student\n');
assert.strictEqual(run('echo %TEMP%'), 'C:\\Users\\Student\\AppData\\Local\\Temp\n');
has('echo %PATH%', 'C:\\Windows\\System32;C:\\Windows');
assert.strictEqual(run('echo %NOPE% 50%'), '%NOPE% 50%\n', 'unknown variables stay as typed');
silent('set COURSE=Operating Systems'); assert.strictEqual(run('echo %COURSE%'), 'Operating Systems\n');
assert.strictEqual(run('set cou'), 'COURSE=Operating Systems\n');
silent('set COURSE='); has('set COURSE', 'Environment variable COURSE not defined');
silent('cd %TEMP%'); assert.strictEqual(sh.prompt, 'C:\\Users\\Student\\AppData\\Local\\Temp>'); silent('cd /d %USERPROFILE%');
has('systeminfo', 'Host Name:                 DESKTOP-CMDSIM', 'OS Name:', 'System Type:               x64-based PC');
has('ver', 'Microsoft Windows [Version');
assert.strictEqual(run('hostname'), 'DESKTOP-CMDSIM\n');
assert.strictEqual(run('whoami'), 'desktop-cmdsim\\student\n');

// ── help: every command is listed, documented and has a clickable example ──
const help = run('help');
for (const name in COMMANDS) {
  const command = COMMANDS[name];
  assert.ok(help.includes(name.toUpperCase()), `help lists ${name}`);
  assert.ok(command.examples.length > 0, `${name} has a cheat-sheet example`);
  assert.strictEqual(run(`help ${name}`), command.help + '\n\n' + command.usage + '\n');
  assert.strictEqual(run(`${name} /?`), run(`help ${name}`));
}
has('help nope', 'This command is not supported by the help utility.');
assert.strictEqual(run('notepad.exe foo'), "'notepad.exe' is not recognized as an internal or external command,\noperable program or batch file.\n");
silent(''); silent('   ');

// ── every cheat-sheet example runs cleanly, top to bottom, on a fresh session ──
const fresh = new Shell(screen);
for (const name in COMMANDS) {
  for (const example of COMMANDS[name].examples) {
    const o = fresh.run(example);
    if (example === 'echo blocked > demo.txt') assert.ok(o.includes(DENIED), 'the read-only demo is refused');
    else assert.ok(!/cannot find|not recognized|denied|Could Not|not correct|Bad command|incorrect|Invalid|undefined/i.test(o), `cheat sheet: "${example}" failed:\n${o}`);
  }
}

console.log('all checks passed');
