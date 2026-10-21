// Local Material Icon Theme assets, shared by buffer headers and attachments.
(() => {
  const extensions = {
    xml:'xml', xsd:'xml', xsl:'xml', xslt:'xml', svg:'image', wsdl:'xml', plist:'xml',
    json:'json', jsonc:'json', jsonl:'json', sql:'database', db:'database', sqlite:'database', sqlite3:'database',
    txt:'document', log:'document', rtf:'document', md:'markdown', mdx:'markdown',
    yaml:'yaml', yml:'yaml', toml:'settings', ini:'settings', conf:'settings', env:'settings',
    js:'javascript', mjs:'javascript', cjs:'javascript', ts:'typescript', mts:'typescript', jsx:'react', tsx:'react',
    py:'python', pyw:'python', java:'java', c:'c', h:'c', cpp:'cpp', hpp:'cpp', cc:'cpp', go:'go', rs:'rust',
    html:'html', htm:'html', css:'css', scss:'css', sass:'css', less:'css',
    pdf:'pdf', doc:'word', docx:'word', odt:'word', xls:'table', xlsx:'table', ods:'table', csv:'table', tsv:'table',
    ppt:'powerpoint', pptx:'powerpoint', odp:'powerpoint',
    png:'image', jpg:'image', jpeg:'image', gif:'image', webp:'image', avif:'image', heic:'image', ico:'image', bmp:'image', tiff:'image',
    zip:'zip', rar:'zip', '7z':'zip', tar:'zip', gz:'zip', bz2:'zip', xz:'zip', tgz:'zip',
    mp3:'audio', wav:'audio', flac:'audio', ogg:'audio', m4a:'audio', aac:'audio',
    mp4:'video', mov:'video', avi:'video', mkv:'video', webm:'video', m4v:'video',
    sh:'console', bash:'console', zsh:'console', ps1:'console', bat:'console', cmd:'console',
    ttf:'font', otf:'font', woff:'font', woff2:'font'
  };
  function kindForFile(name = '', mime = '') {
    const lower = name.toLowerCase();
    if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'docker';
    if (['.gitignore','.gitattributes','.gitmodules'].includes(lower)) return 'git';
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (extensions[ext]) return extensions[ext];
    if (lower === '.env' || lower.startsWith('.env.')) return 'settings';
    const category = mime.toLowerCase().split('/')[0];
    if (['image','video','audio'].includes(category)) return category;
    if (mime === 'application/pdf') return 'pdf';
    if (mime.includes('json')) return 'json';
    if (mime.includes('xml')) return 'xml';
    return category === 'text' ? 'document' : 'file';
  }
  const allowed = new Set([...Object.values(extensions),'file','docker','git']);
  function markup(kind) {
    const safeKind = allowed.has(kind) ? kind : 'file';
    return `<img class="ide-file-icon" src="/static/file-icons/${safeKind}.svg" alt="" aria-hidden="true" draggable="false">`;
  }
  window.fileIcons = {kindForFile, markup};
})();
