# 织幕法务静态站点

「织幕」(Incipel)的对外法务页面:服务条款与隐私政策。纯静态 HTML,无构建步骤。
App Store 上架强制要有一个真实可访问的隐私政策 URL(见 [ADR-0005](../docs/adr/0005-auth-entry-in-v1.md)),本目录保存并发布这些页面。

## 页面与发布地址

由 [`.github/workflows/deploy-legal-pages.yml`](../.github/workflows/deploy-legal-pages.yml) 发布到 GitHub Pages,
站点根为本目录,各页对应:

| 文件 | 发布地址 |
| --- | --- |
| `index.html` | `https://chengdagong.github.io/Incipel/` |
| `legal/index.html` | `https://chengdagong.github.io/Incipel/legal/` |
| `legal/terms/index.html` | `https://chengdagong.github.io/Incipel/legal/terms/` |
| `legal/privacy/index.html` | `https://chengdagong.github.io/Incipel/legal/privacy/` |

登录页 [`apps/mobile/app/login.tsx`](../apps/mobile/app/login.tsx) 的 `TERMS_URL` / `PRIVACY_URL`
指向上表后两个地址。

## 首次启用 GitHub Pages

1. 打开 GitHub 仓库 **Settings → Pages**。
2. **Build and deployment → Source** 选 **GitHub Actions**。
3. 把本目录的改动推到 `main`,workflow 会自动发布;也可在 **Actions** 页手动触发(workflow_dispatch)。

## 正文中的可变信息(已填入)

法务正文据代码实际数据做法撰写;以下三项需由人确定,**现已填入**(两篇法务页面都涉及),变更时同步改两处:

- **联系邮箱** —— `chengdagong@gmail.com`。
- **生效日期** —— 2026 年 6 月 24 日。
- **适用法律与管辖地** —— 适用中华人民共和国法律,争议提交上海市有管辖权的人民法院。

> 注意:正文按当前实现撰写(匿名 / Apple / Google 登录、Supabase 存储、经 OpenRouter 转发给底层模型、
> 无第三方分析与广告等)。若日后改了模型供应商、增删第三方服务或数据做法,或上述三项有变,记得同步更新这两篇法务文本。

## 日后绑定自有域名(可选)

若要把地址换成自有域名 `incipel.app`:在本目录加 `CNAME` 文件(内容为域名),在 **Settings → Pages**
配置自定义域名并在域名服务商处加 DNS 记录;之后把 `login.tsx` 的两个常量改成自有域名地址。
