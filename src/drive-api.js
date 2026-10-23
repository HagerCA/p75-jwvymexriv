// Drive v3 over fetch, drive.file scope: the app only ever sees files it made.

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

export class AuthError extends Error {
  constructor() {
    super('Drive sign-in expired');
    this.name = 'AuthError';
  }
}

export class DriveError extends Error {
  constructor(status) {
    super(`Drive answered ${status}`);
    this.name = 'DriveError';
    this.status = status;
  }
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makeDriveApi(getToken, fetchImpl = globalThis.fetch) {
  async function call(url, init = {}) {
    const token = await getToken();
    if (!token) throw new AuthError();
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new DriveError(res.status);
    return res;
  }

  async function find(q) {
    const u = new URL(API);
    u.searchParams.set('q', q);
    u.searchParams.set('fields', 'files(id,name)');
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('spaces', 'drive');
    return (await (await call(u)).json()).files || [];
  }

  const inParent = (parentId) => `'${esc(parentId || 'root')}' in parents`;

  return {
    async findOrCreateFolder(name, parentId) {
      const hit = await find(`name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and ${inParent(parentId)}`);
      if (hit.length) return hit[0].id;
      const meta = { name, mimeType: FOLDER };
      if (parentId) meta.parents = [parentId];
      const res = await call(`${API}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      });
      return (await res.json()).id;
    },

    async upsertFile(name, parentId, blob, mime) {
      const hit = await find(`name = '${esc(name)}' and trashed = false and ${inParent(parentId)}`);
      if (hit.length) {
        const res = await call(`${UPLOAD}/${hit[0].id}?uploadType=media&fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': mime },
          body: blob,
        });
        return (await res.json()).id;
      }
      const boundary = `p75${Math.random().toString(36).slice(2)}`;
      const meta = { name, parents: [parentId] };
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ]);
      const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return (await res.json()).id;
    },

    async listFiles(parentId) {
      return find(`trashed = false and ${inParent(parentId)}`);
    },

    async download(id) {
      return (await call(`${API}/${id}?alt=media`)).blob();
    },

    async moveFile(id, toParentId, fromParentId) {
      await call(`${API}/${id}?addParents=${encodeURIComponent(toParentId)}&removeParents=${encodeURIComponent(fromParentId)}&fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    },
  };
}
