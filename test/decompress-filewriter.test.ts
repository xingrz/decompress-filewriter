import type { File } from '@xingrz/decompress-types';
import {
  ensureDir,
  mkdirs,
  mkdtemp,
  pathExists,
  readFile,
  realpath,
  remove,
  stat,
  symlink,
  writeFile,
} from 'fs-extra';
import { join } from 'path';
import { randomBytes as _randomBytes } from 'crypto';
import { promisify } from 'util';
import write from '../src';
import { Readable } from 'stream';

const randomBytes = promisify(_randomBytes);

const OUTPUT_DIR = join(__dirname, 'output');

beforeAll(async () => {
  await remove(OUTPUT_DIR);
  await remove('/tmp/dist');
});

afterAll(async () => {
  await remove(OUTPUT_DIR);
  await remove('/tmp/dist');
});

async function createTempDir() {
  await ensureDir(OUTPUT_DIR);
  return await mkdtemp(join(OUTPUT_DIR, 'test-'));
}

class SegmentStream extends Readable {
  source: Buffer;
  offset: number = 0;
  size: number = 20;

  constructor(source: Buffer) {
    super();
    this.source = source;
  }

  _read(n: number): void {
    if (this.offset >= this.source.length) {
      this.push(null);
    } else {
      const buf = this.source.slice(this.offset, this.offset + this.size);
      this.offset += buf.length;
      this.push(buf);
    }
  }
}

test('write file', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);
  await write(file, new SegmentStream(bytes), dist);

  expect(await pathExists(join(dist, 'test.bin'))).toBe(true);
  expect(await readFile(join(dist, 'test.bin'))).toEqual(bytes);
});

test('write file in subdir', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'subdir/a/b/c/test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);
  await write(file, new SegmentStream(bytes), dist);

  expect(await pathExists(join(dist, 'subdir/a/b/c/test.bin'))).toBe(true);
  expect(await readFile(join(dist, 'subdir/a/b/c/test.bin'))).toEqual(bytes);
});

test('write symlink', async () => {
  const dist = await createTempDir();

  const real = join(dist, 'real');
  await writeFile(real, '');

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'link',
    type: 'symlink',
    linkname: 'real',
  };

  await write(file, null, dist);

  expect(await pathExists(join(dist, 'link'))).toBe(true);
  expect(await realpath(join(dist, 'link'))).toEqual(real);
});

test('write hardlink', async () => {
  const dist = await createTempDir();

  const real = join(dist, 'real');
  const bytes = await randomBytes(2000);
  await writeFile(real, bytes);

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'link',
    type: 'link',
    linkname: 'real',
  };

  await write(file, null, dist);

  const realStat = await stat(join(dist, 'real'));
  const linkStat = await stat(join(dist, 'link'));

  expect(await readFile(join(dist, 'link'))).toEqual(bytes);
  expect(linkStat.ino).toEqual(realStat.ino);
});

test('write directory', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0755,
    mtime: new Date(),
    path: 'test',
    type: 'directory',
  };

  await write(file, null, dist);

  const testState = await stat(join(dist, 'test'));

  expect(await pathExists(join(dist, 'test'))).toBe(true);
  expect(testState.isDirectory()).toBe(true);
});

test('strip option', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'subdir/a/b/c/test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);
  await write(file, new SegmentStream(bytes), dist, { strip: 1 });

  expect(await pathExists(join(dist, 'a/b/c/test.bin'))).toBe(true);
  expect(await readFile(join(dist, 'a/b/c/test.bin'))).toEqual(bytes);
});

test('filter option', async () => {
  const dist = await createTempDir();

  const file1: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'test1.bin',
    type: 'file',
  };

  const file2: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'test2.bin',
    type: 'file',
  };

  const bytes1 = await randomBytes(2000);
  const bytes2 = await randomBytes(2000);

  function filter(file: File): boolean {
    return file.path !== 'test1.bin';
  }

  await write(file1, new SegmentStream(bytes1), dist, { filter });
  await write(file2, new SegmentStream(bytes2), dist, { filter });

  expect(await pathExists(join(dist, 'test1.bin'))).toBe(false);
  expect(await pathExists(join(dist, 'test2.bin'))).toBe(true);
  expect(await readFile(join(dist, 'test2.bin'))).toEqual(bytes2);
});

test('map option', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);

  function map(file: File): File {
    file.path = `unicorn-${file.path}`;
    return file;
  }

  await write(file, new SegmentStream(bytes), dist, { map });

  expect(await pathExists(join(dist, 'unicorn-test.bin'))).toBe(true);
  expect(await readFile(join(dist, 'unicorn-test.bin'))).toEqual(bytes);
});

test('set mtime', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date('2021-11-11T12:26:22.225Z'),
    path: 'test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);
  await write(file, new SegmentStream(bytes), dist);

  const testState = await stat(join(dist, 'test.bin'));
  expect(testState.mtime).toEqual(file.mtime);
});

test('throw when a location outside the root is given', async () => {
  const dist = await createTempDir();

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: '../../test.bin',
    type: 'file',
  };

  const bytes = await randomBytes(2000);

  await expect(write(file, new SegmentStream(bytes), dist)).rejects.toThrow(/Refusing/);
});

test('throw when a location outside the root including symlinks is given', async () => {
  const dist = await createTempDir();

  await mkdirs(join(dist, 'generic_dir'));

  await symlink('/', join(dist, 'symlink_to_root'));
  await symlink('../', join(dist, 'generic_dir', 'symlink_to_parent_dir'));

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/symlink_to_root/tmp/slipped_zip.txt',
    type: 'file',
  };

  const bytes = await randomBytes(2000);

  await expect(write(file, new SegmentStream(bytes), dist)).rejects.toThrow(/Refusing/);
});

test('throw when a top-level symlink outside the root is given', async () => {
  const dist = await createTempDir();

  await mkdirs(join(dist, 'generic_dir'));

  await symlink('/tmp/slipped_zip_2.txt', join(dist, 'slipped_zip_2.txt'));
  await symlink('../', join(dist, 'generic_dir', 'symlink_to_parent_dir'));

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/slipped_zip_2.txt',
    type: 'file',
  };

  const bytes = await randomBytes(2000);

  await expect(write(file, new SegmentStream(bytes), dist)).rejects.toThrow(/Refusing/);
});

test('throw when chained symlinks to /tmp/dist allow escape outside root directory', async () => {
  const dist = await createTempDir();

  await mkdirs(join(dist, 'generic_dir'));

  await symlink('second_link', join(dist, 'first_link'));
  await symlink('/var/tmp/slipped_zip_3.txt', join(dist, 'second_link'));
  await symlink('../', join(dist, 'generic_dir', 'symlink_to_parent_dir'));

  const file: File = {
    mode: 0o0644,
    mtime: new Date(),
    path: 'generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/generic_dir/symlink_to_parent_dir/first_link',
    type: 'file',
  };

  const bytes = await randomBytes(2000);

  await expect(write(file, new SegmentStream(bytes), dist)).rejects.toThrow(/Refusing/);
});
