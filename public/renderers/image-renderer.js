class ImageRenderer {
    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        const img = document.createElement('img');
        img.src = `/files?path=${encodeURIComponent(filePath)}`;
        img.style.maxWidth = '100%';
        img.onerror = () => {
            contentOther.textContent = `Failed to load image: ${fileName}`;
        };
        contentOther.appendChild(img);
        contentOther.style.display = 'block';
    }
}