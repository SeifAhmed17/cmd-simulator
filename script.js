'use strict';

/* =====================================================================
   CMD Simulator
     1. Constants and small helpers
     2. VFS            - the in-memory file system
     3. CommandParser  - turns a typed line into a command object
     4. COMMANDS       - one entry per command (also feeds HELP and the cheat sheet)
     5. Shell          - current folder, variables, runs a command
     6. Terminal       - everything on screen: output, typing, history, settings
   ===================================================================== */


/* ---------- 1. Constants and small helpers ---------- */

const VERSION = 'Microsoft Windows [Version 10.0.19045.4529]';
const HOST = 'DESKTOP-CMDSIM';

// The 16 colours of the COLOR command. The position is the hex digit: COLORS[10] is "A".
const COLORS = ['#0c0c0c', '#0037da', '#13a10e', '#3a96dd', '#c50f1f', '#881798', '#c19c00', '#cccccc',
                '#767676', '#3b78ff', '#16c60c', '#61d6d6', '#e74856', '#b4009e', '#f9f1a5', '#f2f2f2'];

// Error messages used by more than one command.
const FILE_NOT_FOUND = 'The system cannot find the file specified.';
const PATH_NOT_FOUND = 'The system cannot find the path specified.';
const ACCESS_DENIED = 'Access is denied.';
const BAD_SYNTAX = 'The syntax of the command is incorrect.';

// 25/11/2026 21:05  ->  "11/25/2026  09:05 PM"
function formatDate(date) {
  const two = number => String(number).padStart(2, '0');
  const hour = date.getHours();
  const day = two(date.getMonth() + 1) + '/' + two(date.getDate()) + '/' + date.getFullYear();
  const time = two(hour % 12 || 12) + ':' + two(date.getMinutes()) + (hour < 12 ? ' AM' : ' PM');
  return day + '  ' + time;
}

// 1234567 -> "1,234,567"
function formatNumber(number) {
  return number.toLocaleString('en-US');
}

// "*.txt" -> a regular expression that matches names ending in .txt (ignoring case)
function wildcardToRegex(pattern) {
  if (pattern === '*.*') pattern = '*';                              // in Windows *.* means "everything"
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');      // make . and friends literal
  return new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

function textContains(line, search, ignoreCase) {
  if (ignoreCase) return line.toLowerCase().includes(search.toLowerCase());
  return line.includes(search);
}


/* ---------- 2. Virtual File System ----------
   A tree of plain objects:
     folder: { name, type: 'dir',  parent, children, modified, readOnly, hidden }
     file:   { name, type: 'file', parent, content,  modified, readOnly, hidden }
   children is a Map from the lower-case name to the node, because Windows names ignore case. */

class VFS {
  constructor() {
    this.root = this.newNode('C:', 'dir', null);
  }

  newNode(name, type, parent) {
    if (parent && /[<>:"|?*]/.test(name)) {
      throw new Error('The filename, directory name, or volume label syntax is incorrect.');
    }
    const node = { name, type, parent, modified: new Date(), readOnly: false, hidden: false };
    if (type === 'dir') node.children = new Map();
    else node.content = '';
    if (parent) parent.children.set(name.toLowerCase(), node);
    return node;
  }

  // "C:/Users\Student" -> "\Users\Student". A leading "\" then means "start at the root".
  normalize(path) {
    return path.replace(/\//g, '\\').replace(/^c:/i, '');
  }

  // Follow a path (absolute, or relative to the folder cwd). Returns the node, or null if nothing is there.
  get(path, cwd) {
    path = this.normalize(path);
    let node = path.startsWith('\\') ? this.root : cwd;
    for (const part of path.split('\\')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        node = node.parent || this.root;
      } else if (node.type === 'dir' && node.children.has(part.toLowerCase())) {
        node = node.children.get(part.toLowerCase());
      } else {
        return null;
      }
    }
    return node;
  }

  // Split a path into its folder and its last name:  "Docs\a.txt" -> { dir: <Docs node>, name: "a.txt" }
  // dir is null when that folder does not exist.
  split(path, cwd) {
    path = this.normalize(path);
    const cut = path.lastIndexOf('\\');
    const dir = cut < 0 ? cwd : this.get(path.slice(0, cut + 1), cwd);
    return { dir: dir && dir.type === 'dir' ? dir : null, name: path.slice(cut + 1) };
  }

  // Full path of a node, e.g. "C:\Users\Student"
  pathOf(node) {
    const names = [];
    for (let n = node; n.parent; n = n.parent) names.unshift(n.name);
    return 'C:\\' + names.join('\\');
  }

  // Everything inside a folder, sorted by name.
  list(dir) {
    return [...dir.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Nodes matching a path whose last part may contain the wildcards * and ?
  match(pattern, cwd) {
    const { dir, name } = this.split(pattern, cwd);
    if (!dir) return [];
    const regex = wildcardToRegex(name);
    return this.list(dir).filter(node => regex.test(node.name));
  }

  // Create a folder and any missing parent folders. Returns false if it already existed.
  makeDir(path, cwd) {
    path = this.normalize(path);
    if (this.get(path, cwd)) return false;
    const cut = path.lastIndexOf('\\');
    if (cut > 0) this.makeDir(path.slice(0, cut), cwd);        // make the parent first
    const { dir, name } = this.split(path, cwd);
    if (!dir || !name) throw new Error(PATH_NOT_FOUND);
    this.newNode(name, 'dir', dir);
    return true;
  }

  // Create a file or change its content. append = add to the end instead of replacing.
  write(path, cwd, text, append) {
    const { dir, name } = this.split(path, cwd);
    if (!dir || !name) throw new Error(PATH_NOT_FOUND);
    let file = dir.children.get(name.toLowerCase());
    if (file && (file.type === 'dir' || file.readOnly)) throw new Error(ACCESS_DENIED);
    if (!file) file = this.newNode(name, 'file', dir);
    file.content = append ? file.content + text : text;
    file.modified = new Date();
  }

  remove(node) {
    node.parent.children.delete(node.name.toLowerCase());
  }

  // Size on a real disk, where every line break takes two bytes (CR + LF).
  sizeOf(file) {
    return file.content.length + file.content.split('\n').length - 1;
  }
}

// The folders and files that exist when the page loads.
function createSampleFiles(fs) {
  const home = 'C:\\Users\\Student\\';
  const docs = home + 'Documents\\';

  const folders = ['C:\\Program Files', 'C:\\Users\\Public', 'C:\\Windows\\System32', home + 'Documents',
                   home + 'Desktop', home + 'Downloads', home + 'AppData\\Local\\Temp'];
  for (const folder of folders) fs.makeDir(folder);

  const files = {
    [home + 'welcome.txt']: 'Welcome to the CMD Simulator!\nType HELP to see every supported command.\nEverything lives in memory - refresh the page to reset.\n',
    [home + 'ntuser.ini']: '[profile]\nuser=Student\n',
    [docs + 'notes.txt']: 'Operating Systems - Lecture Notes\nA process is a program in execution.\nA thread is the smallest unit of CPU scheduling.\nThe kernel manages memory, processes and devices.\nWindows uses the NTFS file system.\n',
    [docs + 'todo.txt']: 'Finish the OS lab report\nPractice CMD commands\nRead chapter 4: Threads\nBackup project files\n',
    [docs + 'fruits.txt']: 'banana\napple\ncherry\nMango\ndate\n',
    [docs + 'report_v1.txt']: 'OS Lab Report\nStudent: Student\nTopic: File Systems\nStatus: Draft\n',
    [docs + 'report_v2.txt']: 'OS LAB REPORT\nStudent: Student\nTopic: File Systems\nStatus: Final\n',
    'C:\\Windows\\win.ini': '; for 16-bit app support\n[fonts]\n[extensions]\n',
    'C:\\Windows\\setuplog.txt': 'Setup started.\nCopying files...\nSetup completed successfully.\n',
  };
  for (const path in files) fs.write(path, fs.root, files[path], false);

  // Two hidden items, so DIR and DIR /A show different lists.
  fs.get(home + 'AppData').hidden = true;
  fs.get(home + 'ntuser.ini').hidden = true;
}


/* ---------- 3. Command Parser ----------
   parse('echo hi > a.txt') returns
     { word: 'echo', name: 'echo', text: ' hi', args: ['hi'], switches: [], file: 'a.txt', append: false }
     word      first word exactly as typed (for the "not recognized" message)
     name      command name in lower case
     text      everything after the name (ECHO, SET, TITLE and PROMPT use it as it is)
     args      the arguments, quotes removed, without switches
     switches  arguments that start with "/", in lower case
     file      where the output goes when the line ends in "> file" or ">> file" (works for every command) */

class CommandParser {
  parse(line, variables) {
    // 1. Replace %NAME% with the value of that variable. Unknown names are left alone.
    line = line.replace(/%(\w+)%/g, (all, name) => variables[name.toUpperCase()] ?? all);
    const word = line.trim().split(/\s+/)[0];

    // 2. Redirection at the end of the line:  > file   or   >> file
    let file = null;
    let append = false;
    const redirect = /(>>?)\s*("[^"]*"|[^\s">]+)\s*$/.exec(line);
    if (redirect) {
      append = redirect[1] === '>>';
      file = redirect[2].replace(/"/g, '');
      line = line.slice(0, redirect.index);
    }

    // 3. The command name. It may be glued to . \ or / as in "cd..", "echo." and "dir/w".
    const [, name, text] = /^\s*([^\s.\\/]*)(.*)$/.exec(line);

    // 4. Split the rest on spaces, keeping "quoted text" together, then drop the quotes.
    const tokens = (text.match(/(?:[^\s"]|"[^"]*")+/g) || []).map(token => token.replace(/"/g, ''));
    const isSwitch = token => token.length > 1 && token.startsWith('/');

    return {
      word,
      name: name.toLowerCase(),
      text: text.trimEnd(),
      args: tokens.filter(token => !isSwitch(token)),
      switches: tokens.filter(isSwitch).map(token => token.toLowerCase()),
      file,
      append,
    };
  }
}


/* ---------- 4. Commands ----------
   Each command has:
     group     heading in the cheat sheet
     help      one-line description
     usage     text shown by "help name" and "name /?"
     examples  clickable lines in the cheat sheet
     run(sh, cmd)   sh = the Shell, cmd = the parsed line.
                    Print with sh.print(text). To stop with an error: throw new Error(message). */

const COMMANDS = {

  /* ----- Terminal ----- */

  cls: {
    group: 'Terminal',
    help: 'Clears the screen.',
    usage: 'CLS',
    examples: ['cls'],
    run(sh) {
      sh.terminal.clear();
    },
  },

  title: {
    group: 'Terminal',
    help: 'Sets the window title.',
    usage: 'TITLE text\n\nChanges the title bar and the browser tab.',
    examples: ['title My CMD Lab'],
    run(sh, cmd) {
      if (cmd.text.trim()) sh.terminal.setTitle(cmd.text.trim());
    },
  },

  color: {
    group: 'Terminal',
    help: 'Sets the console text and background colors.',
    usage: 'COLOR [attr]\n\n' +
      '  attr  Two hex digits: background first, then text. One digit sets only the text.\n' +
      '        No attr restores the default colors. The two digits must be different.\n\n' +
      '    0 = Black       8 = Gray\n' +
      '    1 = Blue        9 = Light Blue\n' +
      '    2 = Green       A = Light Green\n' +
      '    3 = Aqua        B = Light Aqua\n' +
      '    4 = Red         C = Light Red\n' +
      '    5 = Purple      D = Light Purple\n' +
      '    6 = Yellow      E = Light Yellow\n' +
      '    7 = White       F = Bright White\n\n' +
      'Example: COLOR 0A gives light green text on black.',
    examples: ['color 0A', 'color 1F', 'color'],
    run(sh, cmd) {
      const code = (cmd.args[0] || '07').padStart(2, '0');       // "A" means "0A"
      const background = parseInt(code[0], 16);
      const text = parseInt(code[1], 16);
      if (code.length !== 2 || isNaN(background) || isNaN(text) || background === text) {
        sh.print(helpText('color'));
        return;
      }
      sh.terminal.setColor(COLORS[background], COLORS[text]);
    },
  },

  prompt: {
    group: 'Terminal',
    help: 'Changes the command prompt.',
    usage: 'PROMPT [text]\n\n' +
      '  text can contain normal characters and these codes:\n' +
      '    $P  current folder       $G  > (greater-than sign)\n' +
      '    $D  current date         $T  current time\n' +
      '    $N  current drive        $L  < (less-than sign)\n' +
      '    $S  space                $_  new line\n' +
      '    $$  $ (dollar sign)\n\n' +
      'PROMPT without text restores the default, $P$G.',
    examples: ['prompt $T $P$G', 'prompt [%USERNAME%] $P$_$$$S', 'prompt'],
    run(sh, cmd) {
      sh.variables.PROMPT = cmd.text.trim() || '$P$G';
    },
  },

  help: {
    group: 'Terminal',
    help: 'Shows help for the supported commands.',
    usage: 'HELP [command]\n\n  command  Show the usage of that command. "command /?" does the same.',
    examples: ['help', 'help dir', 'copy /?'],
    run(sh, cmd) {
      if (cmd.args.length > 0) {
        const name = cmd.args[0].toLowerCase();
        if (!COMMANDS[name]) throw new Error('This command is not supported by the help utility.');
        sh.print(helpText(name));
        return;
      }
      sh.print('For more information on a specific command, type HELP command-name');
      for (const name of Object.keys(COMMANDS).sort()) {
        sh.print(name.toUpperCase().padEnd(12) + COMMANDS[name].help);
      }
      sh.print();
      sh.print('Any command can save its output:  command > file  (overwrite)   command >> file  (append)');
    },
  },

  /* ----- Directories ----- */

  cd: {
    group: 'Directories',
    help: 'Displays or changes the current directory.',
    usage: 'CD [path]\nCD ..\nCD \\\n\n' +
      '  path  Folder to go to. Quotes are optional for names with spaces.\n' +
      '  ..    Go up one level.\n' +
      '  \\     Go to the root of the drive.\n\n' +
      'CD alone shows the current directory.',
    examples: ['cd', 'cd Documents', 'cd ..', 'cd \\', 'cd "C:\\Program Files"', 'cd /d %USERPROFILE%'],
    run(sh, cmd) {
      if (cmd.args.length === 0) {
        sh.print(sh.fs.pathOf(sh.cwd));
        return;
      }
      const folder = sh.fs.get(cmd.args.join(' '), sh.cwd);       // join: "cd Program Files" works without quotes
      if (!folder) throw new Error(PATH_NOT_FOUND);
      if (folder.type !== 'dir') throw new Error('The directory name is invalid.');
      sh.cwd = folder;
    },
  },

  mkdir: {
    group: 'Directories',
    help: 'Creates one or more directories.',
    usage: 'MKDIR folder [folder ...]\n\nMissing parent folders are created too, so MKDIR Parent\\Child works in one step.',
    examples: ['mkdir Lab1', 'mkdir Lab2 Lab3', 'mkdir Projects\\Web\\css'],
    run(sh, cmd) {
      if (cmd.args.length === 0) throw new Error(BAD_SYNTAX);
      for (const path of cmd.args) {
        const created = sh.fs.makeDir(path, sh.cwd);
        if (!created) sh.print('A subdirectory or file ' + path + ' already exists.');
      }
    },
  },

  rmdir: {
    group: 'Directories',
    help: 'Removes a directory.',
    usage: 'RMDIR [/S] [/Q] folder\n\n' +
      '  /S  Also remove everything inside the folder.\n' +
      '  /Q  Quiet mode (accepted; this simulator never asks for confirmation).\n\n' +
      'Without /S the folder must be empty.',
    examples: ['rmdir Lab1', 'rmdir /s Projects', 'rmdir /s /q Lab2'],
    run(sh, cmd) {
      if (cmd.args.length === 0) throw new Error(BAD_SYNTAX);
      const removeContents = cmd.switches.includes('/s');
      for (const path of cmd.args) {
        const folder = sh.fs.get(path, sh.cwd);
        if (!folder) {
          sh.print(FILE_NOT_FOUND);
        } else if (folder.type !== 'dir') {
          sh.print('The directory name is invalid.');
        } else if (sh.isInside(folder)) {
          sh.print('The process cannot access the file because it is being used by another process.');
        } else if (folder.children.size > 0 && !removeContents) {
          sh.print('The directory is not empty.');
        } else {
          sh.fs.remove(folder);
        }
      }
    },
  },

  dir: {
    group: 'Directories',
    help: 'Lists the files and subdirectories in a directory.',
    usage: 'DIR [folder | pattern] [/A] [/W]\n\n' +
      '  folder   Folder to list (default: the current one).\n' +
      '  pattern  File name with wildcards, for example *.txt\n' +
      '  /A       Also show hidden files and folders.\n' +
      '  /W       Wide format: names only, in columns.',
    examples: ['dir', 'dir /w', 'dir /a', 'dir Documents\\*.txt'],
    run(sh, cmd) {
      const target = cmd.args[0] || '.';
      let folder = sh.fs.get(target, sh.cwd);
      let items;

      if (folder && folder.type === 'dir') {
        // A whole folder. Every folder except the root also lists itself (.) and its parent (..).
        items = sh.fs.list(folder);
        if (folder.parent) {
          const dots = ['.', '..'].map(name => ({ name, type: 'dir', modified: folder.modified, hidden: false }));
          items = dots.concat(items);
        }
      } else {
        // A file name or a wildcard pattern such as *.txt
        folder = sh.fs.split(target, sh.cwd).dir;
        if (!folder) throw new Error(PATH_NOT_FOUND);
        items = sh.fs.match(target, sh.cwd);
      }
      if (!cmd.switches.includes('/a')) items = items.filter(item => !item.hidden);

      sh.print(' Volume in drive C has no label.');
      sh.print(' Volume Serial Number is 1A2B-3C4D');
      sh.print();
      sh.print(' Directory of ' + sh.fs.pathOf(folder));
      sh.print();
      if (items.length === 0) {
        sh.print('File Not Found');
        return;
      }

      if (cmd.switches.includes('/w')) {
        // Wide format: [folders] in brackets, as many columns as fit in 80 characters.
        const names = items.map(item => (item.type === 'dir' ? '[' + item.name + ']' : item.name));
        const width = Math.max(...names.map(name => name.length)) + 3;
        const perRow = Math.max(1, Math.floor(80 / width));
        for (let i = 0; i < names.length; i += perRow) {
          sh.print(names.slice(i, i + perRow).map(name => name.padEnd(width)).join(''));
        }
      } else {
        for (const item of items) {
          const middle = item.type === 'dir' ? '    <DIR>          ' : formatNumber(sh.fs.sizeOf(item)).padStart(18) + ' ';
          sh.print(formatDate(item.modified) + middle + item.name);
        }
      }

      const files = items.filter(item => item.type === 'file');
      let bytes = 0;
      for (const file of files) bytes += sh.fs.sizeOf(file);
      sh.print(String(files.length).padStart(16) + ' File(s) ' + formatNumber(bytes).padStart(14) + ' bytes');
      sh.print(String(items.length - files.length).padStart(16) + ' Dir(s)  120,034,123,776 bytes free');
    },
  },

  tree: {
    group: 'Directories',
    help: 'Draws the folder structure as a tree.',
    usage: 'TREE [folder] [/F] [/A]\n\n' +
      '  /F  Also show the files in each folder.\n' +
      '  /A  Draw with plain ASCII characters.\n\n' +
      'Save the tree to a file:  TREE /F /A > filename.txt',
    examples: ['tree', 'tree /f', 'tree /f /a > tree.txt', 'type tree.txt'],
    run(sh, cmd) {
      const start = sh.fs.get(cmd.args[0] || '.', sh.cwd);
      if (!start || start.type !== 'dir') throw new Error('Invalid path - ' + cmd.args[0]);

      const showFiles = cmd.switches.includes('/f');
      const ascii = cmd.switches.includes('/a');
      const branch = ascii ? '+---' : '├───';        // a folder with more folders after it
      const lastBranch = ascii ? '\\---' : '└───';   // the last folder of its parent
      const pipe = ascii ? '|   ' : '│   ';          // continues the parent's line downwards

      // Draw the contents of one folder; indent is what goes in front of every line.
      function draw(folder, indent) {
        const items = sh.fs.list(folder).filter(item => !item.hidden);
        const folders = items.filter(item => item.type === 'dir');
        const files = items.filter(item => item.type === 'file');

        if (showFiles && files.length > 0) {
          const fileIndent = indent + (folders.length > 0 ? pipe : '    ');
          for (const file of files) sh.print(fileIndent + file.name);
          sh.print(fileIndent);
        }
        folders.forEach((sub, index) => {
          const isLast = index === folders.length - 1;
          sh.print(indent + (isLast ? lastBranch : branch) + sub.name);
          draw(sub, indent + (isLast ? '    ' : pipe));
        });
        return folders.length;
      }

      sh.print('Folder PATH listing');
      sh.print('Volume serial number is 1A2B-3C4D');
      sh.print(cmd.args[0] ? sh.fs.pathOf(start).toUpperCase() : 'C:.');
      if (draw(start, '') === 0) sh.print('No subfolders exist');
    },
  },

  /* ----- Files ----- */

  echo: {
    group: 'Files',
    help: 'Displays a message, or writes it to a file.',
    usage: 'ECHO message\n' +
      'ECHO message > file     Create the file, or replace its content.\n' +
      'ECHO message >> file    Add the message to the end of the file.\n' +
      'ECHO. > file            Write an empty line.\n\n' +
      '%NAME% is replaced by the value of that variable, e.g. ECHO %USERNAME%',
    examples: ['echo Hello World', 'echo First line > demo.txt', 'echo Second line >> demo.txt', 'echo. >> demo.txt'],
    run(sh, cmd) {
      if (cmd.text.startsWith('.')) sh.print(cmd.text.slice(1));       // "echo." prints an empty line
      else if (cmd.text.trim() === '') sh.print('ECHO is on.');
      else sh.print(cmd.text.trim());
    },
  },

  type: {
    group: 'Files',
    help: 'Displays the contents of a text file.',
    usage: 'TYPE file',
    examples: ['type demo.txt', 'type Documents\\notes.txt'],
    run(sh, cmd) {
      if (cmd.args.length === 0) throw new Error(BAD_SYNTAX);
      for (const path of cmd.args) {
        sh.print(sh.file(path).content.replace(/\n$/, ''));
      }
    },
  },

  copy: {
    group: 'Files',
    help: 'Copies one or more files to another location.',
    usage: 'COPY source [destination]\n\n' +
      '  source       File to copy. Wildcards are allowed: COPY *.txt Backup\n' +
      '  destination  A folder to copy into, or a new file name (copy and rename).\n' +
      '               Default: the current folder.',
    examples: ['copy demo.txt backup.txt', 'copy Documents\\*.txt Desktop'],
    run(sh, cmd) {
      if (cmd.args.length === 0) throw new Error(BAD_SYNTAX);
      const source = cmd.args[0];
      const destination = cmd.args[1] || '.';

      const files = sh.fs.match(source, sh.cwd).filter(node => node.type === 'file');
      if (files.length === 0) throw new Error(FILE_NOT_FOUND);

      const destinationNode = sh.fs.get(destination, sh.cwd);
      const intoFolder = destinationNode && destinationNode.type === 'dir';

      for (const file of files) {
        // Into a folder: keep the file's name. Otherwise the destination is the new name.
        const target = intoFolder ? sh.fs.pathOf(destinationNode) + '\\' + file.name : destination;
        sh.fs.write(target, sh.cwd, file.content, false);
        if (files.length > 1) sh.print(file.name);
      }
      sh.print('        ' + files.length + ' file(s) copied.');
    },
  },

  del: {
    group: 'Files',
    help: 'Deletes one or more files.',
    usage: 'DEL file [file ...]\n\n' +
      '  file  File to delete. Wildcards are allowed: DEL *.txt\n\n' +
      'Read-only files (ATTRIB +R) are protected: DEL answers "Access is denied."',
    examples: ['del backup.txt', 'del Desktop\\*.txt'],
    run(sh, cmd) {
      if (cmd.args.length === 0) throw new Error(BAD_SYNTAX);
      for (const path of cmd.args) {
        const files = sh.fs.match(path, sh.cwd).filter(node => node.type === 'file');
        if (files.length === 0) sh.print('Could Not Find ' + path);
        for (const file of files) {
          if (file.readOnly) sh.print(sh.fs.pathOf(file) + '\n' + ACCESS_DENIED);
          else sh.fs.remove(file);
        }
      }
    },
  },

  attrib: {
    group: 'Files',
    help: 'Displays or changes file attributes.',
    usage: 'ATTRIB [+R | -R] [+H | -H] [file]\n\n' +
      '  +R / -R  Turn read-only on / off. A read-only file cannot be deleted\n' +
      '           or overwritten with > and >>.\n' +
      '  +H / -H  Turn hidden on / off. Hidden files are skipped by DIR (use DIR /A).\n' +
      '  file     File name or wildcard. Without it, everything in the folder is listed.',
    examples: ['attrib demo.txt', 'attrib +r demo.txt', 'echo blocked > demo.txt', 'attrib -r demo.txt', 'attrib +h demo.txt', 'attrib -h demo.txt'],
    run(sh, cmd) {
      const changes = cmd.args.filter(arg => /^[+-][rh]$/i.test(arg));          // +r -r +h -h
      const name = cmd.args.find(arg => !/^[+-]/.test(arg)) || '*';
      const nodes = sh.fs.match(name, sh.cwd);
      if (nodes.length === 0) throw new Error('File not found - ' + name);

      for (const node of nodes) {
        for (const change of changes) {
          const turnOn = change[0] === '+';
          if (change[1].toLowerCase() === 'r') node.readOnly = turnOn;
          else node.hidden = turnOn;
        }
        if (changes.length === 0) {
          const flags = 'A   ' + (node.hidden ? 'H' : ' ') + (node.readOnly ? 'R' : ' ');
          sh.print(flags + '       ' + sh.fs.pathOf(node));
        }
      }
    },
  },

  /* ----- Text processing ----- */

  find: {
    group: 'Text processing',
    help: 'Searches for a text string in a file.',
    usage: 'FIND [/I] [/C] "string" file\n\n' +
      '  "string"  Text to look for. The quotes are required.\n' +
      '  /I        Ignore upper/lower case.\n' +
      '  /C        Show only how many lines contain the string.',
    examples: ['find "process" Documents\\notes.txt', 'find /i "WINDOWS" Documents\\notes.txt', 'find /c "the" Documents\\notes.txt'],
    run(sh, cmd) {
      const quoted = /"([^"]*)"/.exec(cmd.text);                 // the search text must be in quotes
      if (!quoted || cmd.args.length < 2) throw new Error('FIND: Parameter format not correct');
      const search = quoted[1];
      const fileName = cmd.args[1];
      const ignoreCase = cmd.switches.includes('/i');

      const matches = sh.readLines(fileName).filter(line => textContains(line, search, ignoreCase));
      sh.print();
      if (cmd.switches.includes('/c')) {
        sh.print('---------- ' + fileName.toUpperCase() + ': ' + matches.length);
      } else {
        sh.print('---------- ' + fileName.toUpperCase());
        for (const line of matches) sh.print(line);
      }
    },
  },

  findstr: {
    group: 'Text processing',
    help: 'Searches for one or more words in a file.',
    usage: 'FINDSTR [/I] [/N] "word1 word2" file\n' +
      'FINDSTR [/I] [/N] /C:"exact phrase" file\n\n' +
      '  "word1 word2"  A line matches if it contains ANY of the words.\n' +
      '  /C:"phrase"    Search for the whole phrase, spaces included.\n' +
      '  /I             Ignore upper/lower case.\n' +
      '  /N             Show the line number before each matching line.',
    examples: ['findstr /i "kernel thread" Documents\\notes.txt', 'findstr /n "CMD" Documents\\todo.txt', 'findstr /c:"file system" Documents\\notes.txt'],
    run(sh, cmd) {
      // With /c:"..." the whole phrase is one search text; otherwise every word is searched on its own.
      const phrase = /\/c:"([^"]*)"/i.exec(cmd.text);
      const words = phrase ? [phrase[1]] : (cmd.args[0] || '').split(' ').filter(word => word !== '');
      const fileName = phrase ? cmd.args[0] : cmd.args[1];
      if (words.length === 0 || !fileName) throw new Error('FINDSTR: Bad command line');

      const ignoreCase = cmd.switches.includes('/i');
      const showNumbers = cmd.switches.includes('/n');
      sh.readLines(fileName).forEach((line, index) => {
        const found = words.some(word => textContains(line, word, ignoreCase));
        if (found) sh.print((showNumbers ? index + 1 + ':' : '') + line);
      });
    },
  },

  sort: {
    group: 'Text processing',
    help: 'Sorts the lines of a text file.',
    usage: 'SORT [/R] file [/O outfile]\n\n' +
      '  /R          Reverse order (Z to A).\n' +
      '  /O outfile  Save the sorted lines in outfile instead of showing them.',
    examples: ['sort Documents\\fruits.txt', 'sort /r Documents\\fruits.txt', 'sort Documents\\fruits.txt /o sorted.txt', 'type sorted.txt'],
    run(sh, cmd) {
      const lines = sh.readLines(cmd.args[0]).sort((a, b) => a.localeCompare(b));
      if (cmd.switches.includes('/r')) lines.reverse();

      if (cmd.switches.includes('/o')) {
        // "sort file /o outfile": the second name is the output file.
        if (!cmd.args[1]) throw new Error(BAD_SYNTAX);
        sh.fs.write(cmd.args[1], sh.cwd, lines.join('\n') + '\n', false);
      } else {
        sh.print(lines.join('\n'));
      }
    },
  },

  fc: {
    group: 'Text processing',
    help: 'Compares two files and shows the lines that differ.',
    usage: 'FC [/C] file1 file2\n\n  /C  Ignore upper/lower case.',
    examples: ['fc Documents\\report_v1.txt Documents\\report_v2.txt', 'fc /c Documents\\report_v1.txt Documents\\report_v2.txt'],
    run(sh, cmd) {
      if (cmd.args.length < 2) throw new Error('FC: Insufficient number of file specifications');
      const name1 = cmd.args[0];
      const name2 = cmd.args[1];
      const lines1 = sh.readLines(name1);
      const lines2 = sh.readLines(name2);
      const ignoreCase = cmd.switches.includes('/c');

      sh.print('Comparing files ' + name1 + ' and ' + name2.toUpperCase());
      // ponytail: compares line 1 with line 1, line 2 with line 2, ... so one inserted line makes every
      // line after it "different". Replace with a real diff (longest common subsequence) if that matters.
      let differences = 0;
      for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        const a = lines1[i] ?? '';
        const b = lines2[i] ?? '';
        const same = ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
        if (same) continue;
        differences++;
        sh.print('***** ' + name1);
        sh.print(a);
        sh.print('***** ' + name2.toUpperCase());
        sh.print(b);
        sh.print('*****');
        sh.print();
      }
      if (differences === 0) sh.print('FC: no differences encountered');
    },
  },

  where: {
    group: 'Text processing',
    help: 'Shows the full path of files that match a name.',
    usage: 'WHERE name\nWHERE /R folder name\n\n' +
      '  name       File name; wildcards are allowed. Searched in the current folder.\n' +
      '  /R folder  Search in that folder and in all of its subfolders.',
    examples: ['where welcome.txt', 'where /R C:\\Users *.txt', 'where /R . notes.txt'],
    run(sh, cmd) {
      const recursive = cmd.switches.includes('/r');
      const start = recursive ? sh.fs.get(cmd.args[0] || '', sh.cwd) : sh.cwd;
      const name = recursive ? cmd.args[1] : cmd.args[0];
      if (!name || !start || start.type !== 'dir') throw new Error('ERROR: Invalid syntax. Type "WHERE /?" for usage.');

      const regex = wildcardToRegex(name);
      let found = 0;
      function search(folder) {
        for (const item of sh.fs.list(folder)) {
          if (item.type === 'file' && regex.test(item.name)) {
            sh.print(sh.fs.pathOf(item));
            found++;
          }
          if (item.type === 'dir' && recursive) search(item);
        }
      }
      search(start);
      if (found === 0) sh.print('INFO: Could not find files for the given pattern(s).');
    },
  },

  /* ----- System ----- */

  set: {
    group: 'System',
    help: 'Displays or sets environment variables.',
    usage: 'SET               Show all variables.\n' +
      'SET name          Show the variables whose names start with name.\n' +
      'SET name=value    Create or change a variable.\n' +
      'SET name=         Remove a variable.\n\n' +
      'Write %name% in any command to use the value, e.g. ECHO %USERNAME%',
    examples: ['set', 'set COURSE=Operating Systems', 'echo %COURSE%', 'echo %USERNAME%', 'echo %USERPROFILE%', 'echo %TEMP%', 'echo %PATH%'],
    run(sh, cmd) {
      const text = cmd.text.trim();
      const equals = text.indexOf('=');

      if (equals > 0) {                                             // set NAME=value
        const name = text.slice(0, equals).toUpperCase();
        const value = text.slice(equals + 1);
        if (value === '') delete sh.variables[name];
        else sh.variables[name] = value;
        return;
      }
      const names = Object.keys(sh.variables).sort().filter(name => name.startsWith(text.toUpperCase()));
      if (names.length === 0) throw new Error('Environment variable ' + text + ' not defined');
      for (const name of names) sh.print(name + '=' + sh.variables[name]);
    },
  },

  systeminfo: {
    group: 'System',
    help: 'Displays information about this (simulated) computer.',
    usage: 'SYSTEMINFO',
    examples: ['systeminfo'],
    run(sh) {
      sh.print();
      sh.print('Host Name:                 ' + HOST);
      sh.print('OS Name:                   Microsoft Windows 10 Pro');
      sh.print('OS Version:                10.0.19045 N/A Build 19045');
      sh.print('OS Manufacturer:           Microsoft Corporation');
      sh.print('Registered Owner:          ' + sh.variables.USERNAME);
      sh.print('System Boot Time:          ' + sh.startTime.toLocaleString('en-US'));
      sh.print('System Manufacturer:       CMD Simulator');
      sh.print('System Model:              In-Memory Virtual Machine');
      sh.print('System Type:               x64-based PC');
      sh.print('Processor(s):              1 Processor(s) Installed.');
      sh.print('Windows Directory:         C:\\Windows');
      sh.print('System Directory:          C:\\Windows\\System32');
      sh.print('Total Physical Memory:     8,192 MB');
      sh.print('Domain:                    WORKGROUP');
    },
  },

  ver: {
    group: 'System',
    help: 'Displays the Windows version.',
    usage: 'VER',
    examples: ['ver'],
    run(sh) {
      sh.print();
      sh.print(VERSION);
    },
  },

  hostname: {
    group: 'System',
    help: 'Displays the name of this computer.',
    usage: 'HOSTNAME',
    examples: ['hostname'],
    run(sh) {
      sh.print(HOST);
    },
  },

  whoami: {
    group: 'System',
    help: 'Displays the current user name.',
    usage: 'WHOAMI',
    examples: ['whoami'],
    run(sh) {
      sh.print((HOST + '\\' + sh.variables.USERNAME).toLowerCase());
    },
  },
};

function helpText(name) {
  return COMMANDS[name].help + '\n\n' + COMMANDS[name].usage;
}


/* ---------- 5. Shell ----------
   Remembers the current folder and the variables, and runs one line at a time.
   It never touches the page itself: for CLS, TITLE and COLOR it calls the terminal. */

class Shell {
  constructor(terminal) {
    this.terminal = terminal;
    this.parser = new CommandParser();
    this.fs = new VFS();
    createSampleFiles(this.fs);
    this.cwd = this.fs.get('C:\\Users\\Student');       // current folder (a node of the file system)
    this.startTime = new Date();
    this.output = '';                                   // what the running command has printed so far
    this.variables = {
      COMPUTERNAME: HOST,
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\Student',
      OS: 'Windows_NT',
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      PROMPT: '$P$G',
      SYSTEMROOT: 'C:\\Windows',
      TEMP: 'C:\\Users\\Student\\AppData\\Local\\Temp',
      USERNAME: 'Student',
      USERPROFILE: 'C:\\Users\\Student',
    };
  }

  // The prompt text, built from the PROMPT variable ($P = path, $G = ">", ...).
  get prompt() {
    const now = new Date();
    const codes = {
      P: this.fs.pathOf(this.cwd), G: '>', L: '<', N: 'C', S: ' ', _: '\n', $: '$',
      D: now.toLocaleDateString('en-US'),
      T: now.toLocaleTimeString('en-GB'),
    };
    const format = this.variables.PROMPT || '$P$G';
    return format.replace(/\$(.)/g, (all, code) => codes[code.toUpperCase()] ?? '');
  }

  print(text = '') {
    this.output += text + '\n';
  }

  // The file a path points to. Throws the error CMD would show if it is missing.
  file(path) {
    if (!path) throw new Error(BAD_SYNTAX);
    const node = this.fs.get(path, this.cwd);
    if (!node) throw new Error(FILE_NOT_FOUND);
    if (node.type === 'dir') throw new Error(ACCESS_DENIED);
    return node;
  }

  // The lines of a text file, as an array.
  readLines(path) {
    const text = this.file(path).content;
    if (text === '') return [];
    return text.replace(/\n$/, '').split('\n');
  }

  // Is the current folder this folder, or somewhere inside it? (Then it cannot be removed.)
  isInside(folder) {
    for (let node = this.cwd; node; node = node.parent) {
      if (node === folder) return true;
    }
    return false;
  }

  // Run one typed line and return the text to show on screen.
  run(line) {
    const cmd = this.parser.parse(line, this.variables);
    if (!cmd.word) return '';
    this.output = '';
    try {
      const command = COMMANDS[cmd.name];
      if (!command) {
        throw new Error("'" + cmd.word + "' is not recognized as an internal or external command,\noperable program or batch file.");
      }
      // Open the "> file" target first, like CMD does: if it is read-only the command never runs.
      if (cmd.file) this.fs.write(cmd.file, this.cwd, '', cmd.append);

      if (cmd.switches.includes('/?')) this.print(helpText(cmd.name));
      else command.run(this, cmd);

      if (cmd.file) {
        this.fs.write(cmd.file, this.cwd, this.output, cmd.append);
        this.output = '';
      }
    } catch (error) {
      this.print(error.message);          // errors always go to the screen, never into the file
    }
    return this.output;
  }
}


/* ---------- 6. Terminal ----------
   The visible part: prints output, mirrors the hidden input into the prompt line,
   keeps the command history, builds the cheat sheet and applies the settings. */

const $ = id => document.getElementById(id);

const DEFAULT_SETTINGS = {
  background: '#0c0c0c',
  text: '#cccccc',
  font: 'Consolas',
  size: '16',
  cursor: 'underscore',
  blink: true,
};

class Terminal {
  constructor() {
    this.screen = $('screen');
    this.output = $('output');
    this.input = $('input');
    this.shell = new Shell(this);
    this.history = [];
    this.historyIndex = 0;
    this.settings = this.loadSettings();

    this.input.addEventListener('keydown', event => this.onKey(event));
    this.input.addEventListener('input', () => this.showInput());
    document.addEventListener('selectionchange', () => this.showInput());     // the caret moved (arrows, Home, End)

    // Click anywhere in the terminal to type - unless the user is selecting text to copy.
    this.screen.addEventListener('mouseup', () => {
      if (String(getSelection()) === '') this.input.focus();
    });

    // Cheat sheet: clicking an example runs it.
    $('sheet').addEventListener('click', event => {
      if (event.target.tagName !== 'BUTTON') return;
      this.run(event.target.textContent);
      this.input.focus();
    });
    $('toggle-sheet').addEventListener('click', () => this.toggleSheet());

    $('settings').addEventListener('input', event => this.onSettingChange(event.target));
    $('reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.applySettings();
    });

    this.buildSheet();
    this.applySettings();
    if (window.innerWidth < 720) this.toggleSheet();        // small screen: start with the sheet closed
    this.print(VERSION + '\n(c) Microsoft Corporation. All rights reserved.\n\n');
    this.showInput();
    this.input.focus();
  }

  /* ----- called by the Shell ----- */

  clear() {
    this.output.textContent = '';
  }

  setTitle(text) {
    $('title').textContent = text;
    document.title = text;
  }

  setColor(background, text) {
    this.settings.background = background;
    this.settings.text = text;
    this.applySettings();
  }

  /* ----- output and input line ----- */

  print(text) {
    this.output.append(text);
  }

  // Copy the hidden input into the visible line. The character under the caret goes into #cursor.
  showInput() {
    const text = this.input.value;
    const caret = this.input.selectionStart;
    const parts = {
      prompt: this.shell.prompt,
      before: text.slice(0, caret),
      cursor: text[caret] || ' ',
      after: text.slice(caret + 1),
    };
    for (const id in parts) {
      if ($(id).textContent !== parts[id]) $(id).textContent = parts[id];
    }
  }

  // Run a line: echo it, show what the command printed, then leave one empty line like CMD does.
  run(line) {
    this.print(this.shell.prompt + line + '\n');
    if (line.trim() !== '') {
      this.history.push(line);
      this.print(this.shell.run(line));
      if (this.output.textContent !== '') this.print('\n');        // no empty line right after CLS
    }
    this.historyIndex = this.history.length;
    this.input.value = '';
    this.showInput();
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  onKey(event) {
    if (event.key === 'Enter') {
      this.run(this.input.value);
    } else if (event.key === 'Escape') {
      this.input.value = '';
      this.showInput();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();                                       // keep the caret at the end of the line
      const index = this.historyIndex + (event.key === 'ArrowUp' ? -1 : 1);
      if (index < 0 || index >= this.history.length) return;
      this.historyIndex = index;
      this.input.value = this.history[index];
      this.showInput();
    }
  }

  /* ----- cheat sheet ----- */

  // One collapsible <details> per group; inside it, each command's name, description and example buttons.
  buildSheet() {
    const groups = {};
    for (const name in COMMANDS) {
      const command = COMMANDS[name];
      if (!groups[command.group]) {
        const details = document.createElement('details');
        details.open = true;
        details.innerHTML = '<summary>' + command.group + '</summary>';
        $('sheet').append(details);
        groups[command.group] = details;
      }
      const heading = document.createElement('div');
      heading.className = 'command';
      heading.innerHTML = '<b>' + name.toUpperCase() + '</b> \u2014 ' + command.help;
      groups[command.group].append(heading);

      for (const example of command.examples) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = example;
        groups[command.group].append(button);
      }
    }
  }

  toggleSheet() {
    $('sheet').hidden = !$('sheet').hidden;
    $('toggle-sheet').setAttribute('aria-expanded', String(!$('sheet').hidden));
  }

  /* ----- settings ----- */

  // Saved settings from the last visit, on top of the defaults.
  loadSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    if (window.innerWidth < 720) settings.size = '13';             // so a DIR row fits on a phone
    try {
      Object.assign(settings, JSON.parse(localStorage.getItem('cmd-settings')));
    } catch {
      // nothing saved yet, or the browser blocks storage: keep the defaults
    }
    return settings;
  }

  // A control in the settings panel changed.
  onSettingChange(control) {
    if (control.id === 'theme') {
      const colors = control.value.split(',');                      // option value is "background,text"
      this.settings.background = colors[0];
      this.settings.text = colors[1];
    } else if (control.type === 'checkbox') {
      this.settings[control.name] = control.checked;
    } else {
      this.settings[control.name] = control.value;
    }
    this.applySettings();
  }

  // Put the settings on screen, in the settings panel, and in storage.
  applySettings() {
    const settings = this.settings;
    this.screen.style.setProperty('--bg', settings.background);
    this.screen.style.setProperty('--fg', settings.text);
    this.screen.style.setProperty('--font', settings.font);
    this.screen.style.setProperty('--size', settings.size + 'px');
    this.screen.dataset.cursor = settings.cursor;
    this.screen.dataset.blink = settings.blink;

    for (const control of $('settings').querySelectorAll('[name]')) {
      if (control.type === 'checkbox') control.checked = settings[control.name];
      else control.value = settings[control.name];
    }
    $('theme').value = settings.background + ',' + settings.text;   // shows blank for a custom colour pair

    try {
      localStorage.setItem('cmd-settings', JSON.stringify(settings));
    } catch {
      // storage blocked: the settings simply last until the page is closed
    }
  }
}


/* ---------- Start ---------- */

if (typeof document !== 'undefined') window.terminal = new Terminal();          // in the browser
if (typeof module !== 'undefined') module.exports = { VFS, CommandParser, Shell, COMMANDS };   // for "node test.js"
