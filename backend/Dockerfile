# Use Node.js 18 with Playwright dependencies
FROM mcr.microsoft.com/playwright:v1.40.1-focal

# Set working directory to root to handle monorepo
WORKDIR /app

# Install pnpm and buf CLI
RUN npm install -g pnpm
RUN curl -sSL "https://github.com/bufbuild/buf/releases/latest/download/buf-$(uname -s)-$(uname -m)" -o "/usr/local/bin/buf" && \
    chmod +x "/usr/local/bin/buf"

# Copy entire project (for buf generate)
COPY . .

# Install root dependencies and generate protobuf
RUN pnpm install --frozen-lockfile
RUN buf generate

# Move to backend directory and install backend deps
WORKDIR /app/backend
RUN pnpm install --frozen-lockfile

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

# Build the backend
RUN pnpm run build

# Expose port (Render will set PORT env var)
EXPOSE $PORT

# Start the application
CMD ["pnpm", "start"]