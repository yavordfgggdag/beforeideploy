// Imported first by bid.mjs: the engine builds its own PATH on every OS (platform/index.mjs buildPath),
// whatever started it — engine/bid, engine/bid.cmd, the desktop shell running node directly, launchd/systemd.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnginePath } from './index.mjs';

applyEnginePath({ engineDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') });
