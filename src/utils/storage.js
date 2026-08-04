// 文件存储抽象。当前本地磁盘实现，未来换云存储（COS/OSS）只改这里。
// 上传接口调 saveFile(buf, ext)，返回可访问的 URL。
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads/avatars');
const URL_PREFIX = '/uploads/avatars'; // koa-static 会服务这个虚拟路径

const storage = {
  /** 保存头像文件，返回 { url, filename } */
  async saveAvatar(buf, ext) {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, buf);
    return {
      filename,
      url: `${URL_PREFIX}/${filename}`,
      // 上线换云时，这里改成 await cos.putObject(...) 并返回 CDN URL
    };
  },
};

module.exports = storage;
