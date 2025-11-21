# Contributing to MIAW MCP Server

First off, thank you for considering contributing to MIAW MCP Server! 🎉

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

**Bug Report Template:**

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Configure with '...'
2. Call tool '...'
3. See error

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened.

**Environment:**
 - Deployment: [Heroku/Local]
 - Salesforce Edition: [Enterprise/Unlimited]
 - ChatGPT Integration: [MCP Connector/Custom GPT]
 - Node Version: [18.x/20.x]

**Logs**
```
Paste relevant logs here
```

**Additional context**
Any other context about the problem.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the suggested enhancement
- **Explain why this enhancement would be useful** to most users
- **List examples** of where this enhancement could be used

### Pull Requests

1. **Fork the repo** and create your branch from `main`
2. **Follow the existing code style** (TypeScript, ESLint)
3. **Add tests** if applicable
4. **Update documentation** if you change functionality
5. **Ensure the build passes** (`npm run build`)
6. **Write a clear commit message**

#### Pull Request Template:

```markdown
**Description**
Brief description of the changes.

**Type of Change**
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

**How Has This Been Tested?**
Describe the tests you ran.

**Checklist:**
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have tested that my changes work with Heroku deployment
- [ ] I have tested that my changes work with ChatGPT integration
```

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/miaw-mcp-server.git
cd miaw-mcp-server

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Salesforce credentials
# (See README.md for how to find these values)

# Build
npm run build

# Test locally
npm start
```

## Code Style Guidelines

### TypeScript

- Use TypeScript for all code
- Define types for all parameters and return values
- Use interfaces for complex objects
- Avoid `any` types when possible

### Naming Conventions

- **Variables/Functions:** `camelCase`
- **Classes/Interfaces:** `PascalCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Files:** `kebab-case.ts`

### Comments

- Use JSDoc for functions and classes
- Explain **why**, not **what** (code should be self-explanatory)
- Keep comments up-to-date with code changes

### Error Handling

- Always use try-catch for async operations
- Provide meaningful error messages
- Log errors to console.error for debugging

## Testing

While we don't have automated tests yet (contributions welcome!), please manually test:

1. **Generate Session:** Verify token generation works
2. **Create Conversation:** Confirm conversation starts
3. **Send Message:** Test message sending
4. **List Entries:** Verify messages are retrieved
5. **Polling:** Confirm server-side polling works correctly
6. **Close Conversation:** Test cleanup

## Documentation

- Update README.md for user-facing changes
- Update code comments for implementation changes
- Add JSDoc for new functions/classes
- Include examples for new features

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat: Add support for file attachments in messages

fix: Correct polling timeout calculation

docs: Update Heroku deployment instructions

refactor: Extract polling logic into separate function
```

## Review Process

1. All pull requests require at least one review
2. Address review comments promptly
3. Keep PRs focused (one feature/fix per PR)
4. Be respectful and constructive in discussions

## Community

- Be welcoming and inclusive
- Respect differing viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what is best for the community

## Questions?

Feel free to ask questions by:
- Opening a GitHub Discussion
- Commenting on relevant issues
- Reaching out to maintainers

Thank you for contributing! 🙌

