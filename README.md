# Let's gogogo

一个支持多用户、云端持久化和手机安装的目标管理应用。

## 这版解决了什么

- 登录、注册、自动登录接口保持一致
- JWT 登录验证，用户只能读取和保存自己的数据
- Supabase PostgreSQL 是主数据源，Render 重启或重新部署不会删除用户数据
- 浏览器保留当前用户的本地备份，临时断网时修改不会立刻丢失
- 支持安装到 iPhone、Android 和电脑桌面
- 网站更新与数据库分离，发布新版不会清空用户数据

## 第一次部署

### 1. 创建 Supabase 免费数据库

1. 在 <https://supabase.com> 创建项目。
2. 打开项目的 `SQL Editor`。
3. 粘贴并执行 [supabase-schema.sql](./supabase-schema.sql)。
4. 在 `Project Settings` -> `API` 中找到：
   - Project URL，对应 `SUPABASE_URL`
   - `service_role` key，对应 `SUPABASE_SERVICE_ROLE_KEY`

`service_role` key 只能放在 Render 环境变量中，绝对不能写进网页或发给用户。

### 2. 部署到 Render

1. 把此文件夹上传到一个 GitHub 仓库。
2. 在 <https://render.com> 新建 `Web Service` 并连接该仓库。
3. 配置：

| 配置 | 值 |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

4. 添加环境变量：

| 名称 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 至少 32 位的随机字符串 |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |

也可以使用仓库中的 [render.yaml](./render.yaml) 创建 Blueprint。

## 发布新版但保留数据

以后只需要修改代码并推送到同一个 GitHub 仓库。Render 会自动重新部署网站，而用户数据仍保存在 Supabase 的 `app_users` 表中。

不要删除 Supabase 项目或 `app_users` 表。发布前建议在 Supabase 中导出数据库备份。

安装到桌面的应用会在重新打开且联网时获取新版本。旧版本的缓存由 `service-worker.js` 自动替换。

## 手机安装

- iPhone：使用 Safari 打开网站，点击分享，再点击“添加到主屏幕”。
- Android：使用 Chrome 打开网站，点击菜单，再点击“安装应用”或“添加到主屏幕”。
- 电脑：使用 Chrome 或 Edge 打开网站，点击地址栏中的安装图标。

## 本地开发

```bash
npm install
npm start
```

未设置 Supabase 环境变量时，本地开发会使用 `data/users.json`。生产环境强制要求 Supabase，防止误用临时文件存储。

## 重要说明

- Render 免费服务可能休眠，休眠后的第一次访问会较慢。
- Supabase 和 Render 的免费政策可能变化，上线后要定期查看用量和服务通知。
- 本应用目前采用“最后一次保存覆盖云端”的同步方式，不建议同一账号在两个设备上同时编辑。
