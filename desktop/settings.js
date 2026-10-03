const $ = id => document.getElementById(id);
const mode = () => document.querySelector('input[name=mode]:checked').value;
function showMode() {
  $('local').hidden = mode() !== 'local';
  $('remote').hidden = mode() !== 'remote';
  $('url').required = mode() === 'remote';
}
document.querySelectorAll('input[name=mode]').forEach(input => input.addEventListener('change', showMode));
$('choose').addEventListener('click', async () => {
  const path = await window.desktop.chooseDirectory();
  if (path) $('directory').value = path;
});
$('connection').addEventListener('submit', async event => {
  event.preventDefault();
  $('controls').disabled = true;
  $('status').textContent = 'Connecting…';
  try {
    const config = mode() === 'remote' ? { mode: 'remote', url: $('url').value } : {
      mode: 'local', dataDir: $('directory').value, port: Number($('port').value), shareNetwork: $('share').checked,
    };
    const result = await window.desktop.connect(config);
    $('status').textContent = result.error || '';
  } catch (error) { $('status').textContent = error.message; }
  finally { $('controls').disabled = false; }
});
window.desktop.load().then(({ config, defaultDirectory, error }) => {
  $('directory').value = config?.mode === 'local' ? config.dataDir : defaultDirectory;
  if (config?.mode === 'remote') {
    document.querySelector('input[value=remote]').checked = true;
    $('url').value = config.url;
  } else if (config) {
    $('port').value = config.port;
    $('share').checked = config.shareNetwork;
  }
  $('status').textContent = error || '';
  showMode();
}).catch(error => { $('status').textContent = error.message; });
