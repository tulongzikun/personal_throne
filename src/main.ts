import './ui/styles/base.css';

const APP_VERSION = '0.1.0';

function mount(root: HTMLElement): void {
  root.innerHTML = `
    <main class="boot">
      <h1>王座与黄金</h1>
      <p>Throne &amp; Gold · v${APP_VERSION}</p>
      <p class="boot__hint">世界尚未生成 · M0 工程基线已就绪</p>
    </main>
  `;
}

const root = document.getElementById('app');
if (!root) {
  throw new Error('挂载点 #app 不存在');
}
mount(root);
