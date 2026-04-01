# Contributing to schedex

Thanks for your interest in contributing to schedex! This guide covers everything you need to get started.

## Prerequisites

- **Node.js 20** or later
- **npm** (comes with Node.js)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Darkroom4364/ticker.git
cd ticker

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch
```

## Code Style

This project uses **ESLint** and **Prettier** to enforce consistent code style. Before submitting a PR, make sure your code passes linting and formatting checks:

```bash
npm run lint
npm run format
```

TypeScript strict mode is enabled — avoid `any` types and ensure proper error handling.

## Submitting a Pull Request

1. Fork the repository and create a feature branch from `main`.
2. Keep PRs focused — one logical change per PR.
3. Add tests for any new features or bug fixes.
4. Make sure all tests pass and the project builds cleanly (`npm run build && npm test`).
5. Write a clear PR description explaining what changed and why.

## Adding a Scanner

If you're adding a new infrastructure scanner:

1. Create a new file in `src/scanners/`.
2. Implement the `Scanner` interface (`name`, `scan()`, `isAvailable()`).
3. Register the scanner in `src/scanners/index.ts`.
4. Add tests for the scanner.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/Darkroom4364/ticker/issues).
