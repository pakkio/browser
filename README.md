# 🗂️ Modern File Browser

A sleek, modern web-based file browser with support for multiple file types including PDFs and comic book archives. Built with Node.js and Express, featuring a stunning glassmorphism UI.

![File Browser Screenshot](https://via.placeholder.com/800x400/667eea/ffffff?text=Modern+File+Browser)

## ✨ Features

### 📁 File Management
- **Directory Navigation** - Browse folders with intuitive breadcrumb navigation
- **File Type Icons** - Visual indicators for different file types
- **Smooth Animations** - Fluid hover effects and transitions

### 📄 Document Support
- **PDF Viewer** - Page-by-page PDF navigation with image conversion
- **Comic Book Archives** - Support for CBZ (ZIP) and CBR (RAR) formats
- **Code Highlighting** - Syntax highlighting for programming languages

### 🎨 Media Support
- **Images** - JPG, JPEG, PNG, GIF, WebP preview
- **Video** - MP4 playback with controls
- **Audio** - MP3 playback with controls

### 🎯 Modern UI
- **Glassmorphism Design** - Translucent panels with backdrop blur
- **Purple Gradient Theme** - Stunning color scheme
- **Responsive Layout** - Works on desktop and mobile
- **Custom Scrollbars** - Themed scrolling experience

## 🚀 Quick Start

### Prerequisites
- Node.js 14+
- ImageMagick or GraphicsMagick (for PDF support)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd browser

# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at `http://localhost:3000`

### Custom Directory

Browse a specific directory:
```bash
node server.js /path/to/your/directory
```

## 📋 Supported File Types

| Type | Extensions | Features |
|------|------------|----------|
| **Documents** | PDF | Page navigation, image conversion |
| **Comics** | CBZ, CBR | Page navigation, archive extraction |
| **Images** | JPG, JPEG, PNG, GIF, WebP | Full-size preview, hover effects |
| **Videos** | MP4 | HTML5 video player with controls |
| **Audio** | MP3 | HTML5 audio player with controls |
| **Code** | JS, HTML, CSS, JSON, PY, JAVA, C, CPP, GO, RS, MD, TXT | Syntax highlighting |

## 🎨 UI Features

### File Browser
- **Icon-based navigation** with emoji indicators
- **Hover animations** with 3D transforms
- **Color-coded file types** for quick identification
- **Glassmorphism effects** with translucent backgrounds

### Document Viewer
- **PDF Controls** - Blue gradient buttons for PDF navigation
- **Comic Controls** - Green gradient buttons for comic navigation
- **Responsive images** with hover zoom effects
- **Professional typography** with modern fonts

### Technical Details
- **Backdrop filters** for glassmorphism effects
- **CSS Grid/Flexbox** for responsive layouts
- **Custom scrollbars** matching the theme
- **Smooth transitions** using cubic-bezier curves

## 🛠️ Dependencies

### Backend
- **express** - Web server framework
- **pdf2pic** - PDF to image conversion
- **yauzl** - ZIP/CBZ archive extraction
- **node-unrar-js** - RAR/CBR archive extraction

### Frontend
- **highlight.js** - Code syntax highlighting
- **Modern CSS** - Glassmorphism and animations

## 📁 Project Structure

```
browser/
├── public/           # Frontend assets
│   ├── index.html   # Main HTML file
│   ├── script.js    # Client-side JavaScript
│   └── style.css    # Modern glassmorphism styles
├── server.js        # Express server with file handling
├── package.json     # Dependencies and scripts
└── README.md        # This file
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/browse` | GET | List directory contents |
| `/files` | GET | Serve file content |
| `/pdf-preview` | GET | Convert PDF page to image |
| `/comic-preview` | GET | Extract comic page from archive |

## 🎯 Usage Examples

### Browse Files
Navigate through directories by clicking on folders. Files display with appropriate icons based on their type.

### View PDFs
Click on any PDF file to open the document viewer with page navigation controls.

### Read Comics
Click on CBZ or CBR files to open the comic reader with page-by-page navigation.

### Preview Code
Text and code files open with syntax highlighting for better readability.

## 🔒 Security Features

- **Path validation** prevents directory traversal attacks
- **File type restrictions** for safe browsing
- **Base directory enforcement** keeps browsing within bounds

## 📱 Responsive Design

The interface adapts to different screen sizes:
- **Desktop**: Side-by-side layout with 350px browser panel
- **Mobile**: Stacked layout with 40/60 height split

## 🎨 Customization

### Colors
The theme uses a purple gradient scheme with glassmorphism effects. Main colors:
- Primary: `#667eea` to `#764ba2`
- Accent: `#ff6b6b` to `#4ecdc4`
- Background: Translucent white overlays

### Animations
- **Hover effects**: 3D transforms with shadows
- **Transitions**: Smooth cubic-bezier curves
- **Loading states**: Spinning indicators

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🙏 Acknowledgments

- **highlight.js** for code syntax highlighting
- **pdf2pic** for PDF processing
- **yauzl** and **node-unrar-js** for archive handling
- Modern CSS techniques for glassmorphism effects