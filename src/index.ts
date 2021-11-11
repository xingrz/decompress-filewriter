import type { File } from '@xingrz/decompress-types';
import type { Readable } from 'stream';
import { dirname, join } from 'path';
import { createWriteStream } from 'fs';
import { realpath, readlink, utimes, link, symlink, mkdirs } from 'fs-extra';
import { pipeline as _pipeline } from 'stream';
import { promisify } from 'util';
import stripDirs from 'strip-dirs';

const pipeline = promisify(_pipeline);

export interface DecompressFileWriterOptions {
  /**
   * Filter out files before extracting
   */
  filter?(file: File): boolean;

  /**
   * Map files before extracting
   */
  map?(file: File): File;

  /**
   * Remove leading directory components from extracted files.
   * Default: 0
   */
  strip?: number;
}

async function safeMakeDir(dir: string, realOutputPath: string): Promise<string> {
  let realParentPath: string;
  try {
    realParentPath = await realpath(dir);
  } catch (e) {
    const parent = dirname(dir);
    realParentPath = await safeMakeDir(parent, realOutputPath);
  }

  if (!realParentPath.startsWith(realOutputPath)) {
    throw new Error('Refusing to create a directory outside the output path.');
  }

  await mkdirs(dir);
  return await realpath(dir);
}

async function preventWritingThroughSymlink(destination: string): Promise<void> {
  let symlinkPointsTo: string;
  try {
    symlinkPointsTo = await readlink(destination);
  } catch (_) {
    // Either no file exists, or it's not a symlink. In either case, this is
    // not an escape we need to worry about in this phase.
    return;
  }

  if (symlinkPointsTo) {
    throw new Error('Refusing to write into a symlink');
  }

  // No symlink exists at `destination`, so we can continue
}

export default async function write(file: File, input: Readable | null, output: string, opts?: DecompressFileWriterOptions): Promise<void> {
  const strip = opts?.strip || 0;
  if (strip > 0) {
    file.path = stripDirs(file.path, strip);
    if (file.path == '.') return;
  }

  if (typeof opts?.filter === 'function') {
    if (!opts.filter(file)) {
      if (input) input.resume();
      return;
    }
  }

  if (typeof opts?.map === 'function') {
    file = opts.map(file);
  }

  const dest = join(output, file.path);
  const now = new Date();

  await mkdirs(output);
  const realOutputPath = await realpath(output);

  if (file.type === 'directory') {
    await safeMakeDir(dest, realOutputPath);
    await utimes(dest, now, new Date(file.mtime));
    return;
  }

  // Attempt to ensure parent directory exists (failing if it's outside the output dir)
  await safeMakeDir(dirname(dest), realOutputPath);

  if (file.type === 'file') {
    await preventWritingThroughSymlink(dest);
  }

  const realDestinationDir = await realpath(dirname(dest));
  if (!realDestinationDir.startsWith(realOutputPath)) {
    throw new Error('Refusing to write outside output directory: ' + realDestinationDir);
  }

  if (file.type === 'link') {
    await link(join(output, file.linkname!), dest);
  } else if (file.type === 'symlink') {
    if (process.platform === 'win32') {
      await link(join(output, file.linkname!), dest);
    } else {
      await symlink(file.linkname!, dest);
    }
  }

  if (file.type === 'file' && input) {
    await pipeline(input, createWriteStream(dest, { mode: file.mode }));
    await utimes(dest, now, new Date(file.mtime));
  }
}
