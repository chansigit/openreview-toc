# OpenReview Reviewer TOC

在 OpenReview 论文页右侧显示审稿人及讨论目录。每位审稿人下按原页面层级列出作者和审稿人的每条回复，点击可跳转并展开对应内容。目录可折叠，随页面内容加载、排序和筛选自动更新。支持新版页面及旧版评审布局。

## 安装到 Chrome

1. 打开 `chrome://extensions`，开启右上角的「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目文件夹（包含 `manifest.json`）。
3. 打开或刷新 OpenReview 论文页，例如 `https://openreview.net/forum?id=论文ID`。

无需安装 npm 依赖或构建。修改插件后，在扩展程序页面点击重新加载，再刷新论文页。

## 使用

- 点击审稿人名称，跳转到评审并短暂高亮。
- 每条回复显示发言者和标题，按回复关系缩进；点击会展开上层讨论并跳转到该条回复。较长标题显示两行，鼠标悬停可查看完整标题。
- 点击「审稿人目录」收起或展开；窄窗口时目录位于右下角。
- 名称与页面显示的署名一致，匿名评审显示匿名编号。
- 列出已加载且未被页面筛选隐藏的 Review / Official Review，以及它们下面的所有讨论回复。不列出独立的 Meta Review 或未挂在评审下的评论。看不到某条回复时，先检查 OpenReview 的筛选和「View More Replies」加载状态。

插件只在本地读取当前页面 DOM，不请求 OpenReview API，不上传或保存评审内容；无需账户凭据、额外权限或后台服务。脚本覆盖 OpenReview 域名以兼容站内导航，目录只显示在 `/forum?id=…` 页面。

## 开发验证

```sh
npm install
npx playwright install chromium
npm test
```

测试会用独立的临时 Chromium 配置实际加载插件，验证新旧版结构、多层回复归属、无关评论排除、动态加载、标题更新、节点替换、折叠、点击跳转、文本安全和窄屏布局。页面结构参考 [OpenReview 官方前端](https://github.com/openreview/openreview-web)，截图保存到 `test-results/`。

自动化访问真实 OpenReview 页面可能触发浏览器验证；测试使用按官方源码构造的页面，不代表已验证所有会议页面。依赖 OpenReview 的 DOM 结构和英文评审类型标签；初始就折叠且使用自定义标题的评审，可能需在原页面展开后才被识别。网站结构变化时可能需要更新选择器。
