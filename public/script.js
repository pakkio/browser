
document.addEventListener('DOMContentLoaded', () => {
    const fileList = document.getElementById('file-list');
    const contentCode = document.getElementById('content-code');
    const contentOther = document.getElementById('content-other');
    let currentPath = '';

    function loadFiles(path) {
        fetch(`/api/browse?path=${encodeURIComponent(path)}`)
            .then(response => response.json())
            .then(data => {
                fileList.innerHTML = '';
                if (path !== '') {
                    const parentLi = document.createElement('li');
                    parentLi.textContent = '..';
                    parentLi.classList.add('parent-dir');
                    parentLi.addEventListener('click', () => {
                        currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
                        loadFiles(currentPath);
                    });
                    fileList.appendChild(parentLi);
                }
                data.forEach(file => {
                    const li = document.createElement('li');
                    li.textContent = file.name;
                    
                    // Add file type data attribute for styling
                    if (file.isDirectory) {
                        li.textContent += '/';
                        li.setAttribute('data-type', 'directory');
                        li.addEventListener('click', () => {
                            currentPath = path ? `${path}/${file.name}` : file.name;
                            loadFiles(currentPath);
                        });
                    } else {
                        const extension = file.name.split('.').pop().toLowerCase();
                        
                        if (extension === 'pdf') {
                            li.setAttribute('data-type', 'pdf');
                        } else if (['cbz', 'cbr'].includes(extension)) {
                            li.setAttribute('data-type', 'comic');
                        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
                            li.setAttribute('data-type', 'image');
                        } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) {
                            li.setAttribute('data-type', 'video');
                        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
                            li.setAttribute('data-type', 'audio');
                        } else if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs'].includes(extension)) {
                            li.setAttribute('data-type', 'code');
                        }
                        
                        li.addEventListener('click', () => showContent(path, file.name));
                    }
                    fileList.appendChild(li);
                });
            });
    }

    function showContent(path, fileName) {
        const filePath = path ? `${path}/${fileName}` : fileName;
        const extension = fileName.split('.').pop().toLowerCase();

        contentCode.innerHTML = '';
        contentOther.innerHTML = '';
        contentCode.parentElement.style.display = 'none';
        contentOther.style.display = 'none';

        if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs'].includes(extension)) {
            fetch(`/files?path=${encodeURIComponent(filePath)}`)
                .then(response => response.text())
                .then(text => {
                    contentCode.textContent = text;
                    contentCode.className = `language-${extension}`;
                    hljs.highlightElement(contentCode);
                    contentCode.parentElement.style.display = 'block';
                });
        } else if (extension === 'pdf') {
            showPdfContent(filePath);
        } else if (['cbz', 'cbr'].includes(extension)) {
            showComicContent(filePath);
        } else if (['jpg', 'jpeg', 'png', 'gif'].includes(extension)) {
            const img = document.createElement('img');
            img.src = `/files?path=${encodeURIComponent(filePath)}`;
            img.style.maxWidth = '100%';
            contentOther.appendChild(img);
            contentOther.style.display = 'block';
        } else if (['mp3'].includes(extension)) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = `/files?path=${encodeURIComponent(filePath)}`;
            contentOther.appendChild(audio);
            contentOther.style.display = 'block';
        } else if (['mp4'].includes(extension)) {
            const video = document.createElement('video');
            video.controls = true;
            video.src = `/files?path=${encodeURIComponent(filePath)}`;
            video.style.maxWidth = '100%';
            contentOther.appendChild(video);
            contentOther.style.display = 'block';
        } else {
            contentOther.textContent = 'File type not supported for preview.';
            contentOther.style.display = 'block';
        }
    }

    function showPdfContent(filePath) {
        const pdfContainer = document.createElement('div');
        pdfContainer.className = 'pdf-container';
        
        const controls = document.createElement('div');
        controls.className = 'pdf-controls';
        controls.innerHTML = `
            <button id="pdf-prev">Previous</button>
            <span id="pdf-page-info">Page 1</span>
            <button id="pdf-next">Next</button>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        
        pdfContainer.appendChild(controls);
        pdfContainer.appendChild(pageImg);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        let currentPage = 1;
        
        function loadPage(page) {
            pageImg.src = `/pdf-preview?path=${encodeURIComponent(filePath)}&page=${page}`;
            document.getElementById('pdf-page-info').textContent = `Page ${page}`;
        }
        
        document.getElementById('pdf-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadPage(currentPage);
            }
        });
        
        document.getElementById('pdf-next').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });
        
        loadPage(currentPage);
    }

    function showComicContent(filePath) {
        const comicContainer = document.createElement('div');
        comicContainer.className = 'comic-container';
        
        const controls = document.createElement('div');
        controls.className = 'comic-controls';
        controls.innerHTML = `
            <button id="comic-prev">Previous</button>
            <span id="comic-page-info">Page 1</span>
            <button id="comic-next">Next</button>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        pageImg.style.display = 'block';
        pageImg.style.margin = '0 auto';
        
        comicContainer.appendChild(controls);
        comicContainer.appendChild(pageImg);
        contentOther.appendChild(comicContainer);
        contentOther.style.display = 'block';
        
        let currentPage = 1;
        
        function loadPage(page) {
            pageImg.src = `/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`;
            document.getElementById('comic-page-info').textContent = `Page ${page}`;
        }
        
        document.getElementById('comic-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadPage(currentPage);
            }
        });
        
        document.getElementById('comic-next').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });
        
        loadPage(currentPage);
    }

    loadFiles(currentPath);
});
