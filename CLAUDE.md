# Modern File Browser - Development Guidelines

## Project Overview
A sleek, modern web-based file browser with support for multiple file types including PDFs and comic book archives. Built with Node.js and Express, featuring a glassmorphism UI.

## Development Commands
```bash
# Install dependencies
npm install

# Start development server
npm start

# Run tests
npm test
npm run test:coverage
npm run test:watch

# Check project health
node server.js --help

# Rust server (server-rs/, shipped by the Windows installer)
npm run build:rust
cd server-rs && cargo test --release && cargo clippy --release
npm run test:parity   # Node vs Rust, request by request
```

The Node server (server.js, lib/, routes/) and the Rust server (server-rs/) answer the same API.
A change to one belongs in the other too; add a request to tests/parity/parity.test.js to keep
them in step.

## Commit Guidelines

### Commit Message Format
Use conventional commit format:
```
type(scope): brief description

Longer description if needed explaining the why behind the change.
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes  
- `docs`: Documentation changes
- `style`: Code style/formatting
- `refactor`: Code restructuring
- `test`: Adding/updating tests
- `chore`: Build/tooling changes

**Examples:**
```
feat(pdf): add double-page viewing mode
fix(auth): resolve session timeout issue
docs: update installation instructions
test(comic): add CBR extraction tests
```

### What NOT to Include in Commits
- **AI/Assistant references**: Avoid mentioning Claude, AI assistance, or automated generation
- **Sensitive information**: Never commit `.env` files, API keys, passwords, tokens
- **Personal information**: Email addresses, names, internal paths
- **Debug code**: console.log statements, temporary test code
- **Large binaries**: Images, videos, compiled files (use .gitignore)

### Pre-Commit Checklist
Before committing, ensure:
- [ ] No sensitive data (check `.env`, config files)
- [ ] No AI/Claude references in commit messages or code comments
- [ ] Tests pass (`npm test`)
- [ ] Code follows existing style patterns
- [ ] No console.log or debug statements
- [ ] .gitignore updated for new file types if needed

### Security Best Practices
- Always review `git diff` before committing
- Use environment variables for sensitive config
- Keep `.env.example` updated but never commit actual `.env`
- Validate file paths to prevent directory traversal
- Sanitize user inputs in all handlers

## File Structure Conventions
```
browser/
├── lib/              # Server-side modules
├── public/           # Frontend assets
│   └── renderers/    # Document type renderers
├── server-rs/        # Rust port of the server (one program, used by the MSI)
├── mega-sidecar/     # Node helper the Rust server runs for mega.nz
├── tests/            # Test files (tests/parity: Node vs Rust)
├── .env.example      # Environment template
├── .gitignore        # Git ignore rules
└── server.js         # Main server file
```

## Testing Requirements
- Maintain >65% test coverage
- Add tests for new features
- Test error conditions and edge cases
- Include integration tests for new endpoints

## Code Quality Standards
- Follow existing code style and patterns
- Use meaningful variable/function names
- Add JSDoc comments for complex functions
- Handle errors gracefully with user-friendly messages
- Validate inputs and sanitize outputs

## Dependencies Management
- Keep dependencies minimal and up-to-date
- Document any new system requirements (ImageMagick, FFmpeg)
- Test cross-platform compatibility when possible
- Use exact versions for critical dependencies