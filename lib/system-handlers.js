const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { baseDir } = require('./config');

// Open file with default system program
function openFile(req, res) {
    try {
        const { filePath } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Resolve full path within baseDir
        const fullPath = path.resolve(baseDir, filePath.startsWith('/') ? filePath.slice(1) : filePath);
        
        // Security check: ensure file is within baseDir
        if (!fullPath.startsWith(path.resolve(baseDir))) {
            return res.status(403).json({ error: 'Access denied: file outside allowed directory' });
        }
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Determine the command based on platform
        let command, args;
        
        if (process.platform === 'win32') {
            // Windows
            command = 'cmd';
            args = ['/c', 'start', '""', fullPath];
        } else if (process.platform === 'darwin') {
            // macOS
            command = 'open';
            args = [fullPath];
        } else {
            // Linux and other Unix-like systems
            command = 'xdg-open';
            args = [fullPath];
        }
        
        // Execute the command
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore'
        });
        
        child.unref(); // Don't keep the parent process alive
        
        console.log(`[${new Date().toISOString()}] 📂 Opened file with default program: ${filePath}`);
        res.json({ success: true, message: 'File opened successfully' });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error opening file: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    openFile
};