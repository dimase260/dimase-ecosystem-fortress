#!/bin/bash
# ============================================================
# DiMase Inc Website - Automated Installation Script
# ============================================================
# This script sets up the complete dimaseinc.org website
# and deploys it to Cloudflare Workers (free hosting)
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[*]${NC} $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "=============================================="
echo "  DiMase Inc Website Installation Script"
echo "=============================================="
echo ""

# Check for Node.js
print_status "Checking for Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js found: $NODE_VERSION"
else
    print_error "Node.js not found. Installing..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install node
    else
        print_error "Please install Node.js manually: https://nodejs.org"
        exit 1
    fi
fi

# Check for npm
print_status "Checking for npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    print_success "npm found: $NPM_VERSION"
else
    print_error "npm not found. Please install Node.js with npm."
    exit 1
fi

# Install/Update Wrangler
print_status "Installing Wrangler CLI..."
npm install -g wrangler@latest
print_success "Wrangler installed"

# Check if already in project directory
if [ -f "wrangler.jsonc" ]; then
    print_success "Already in project directory"
else
    print_warning "wrangler.jsonc not found in current directory"
    print_status "Please run this script from the dimaseinc-website directory"
    exit 1
fi

# Authenticate with Cloudflare
print_status "Checking Cloudflare authentication..."
if npx wrangler whoami &> /dev/null; then
    print_success "Already authenticated with Cloudflare"
else
    print_status "Please authenticate with Cloudflare..."
    npx wrangler login
fi

# Deploy
print_status "Deploying to Cloudflare Workers..."
npx wrangler deploy

echo ""
echo "=============================================="
print_success "Installation Complete!"
echo "=============================================="
echo ""
echo "Your website is now live at:"
echo "  - https://dimaseinc.org"
echo "  - https://www.dimaseinc.org"
echo "  - https://dimaseinc-website.mrcdimase.workers.dev"
echo ""
echo "To make updates:"
echo "  1. Edit files in this directory"
echo "  2. Run: npx wrangler deploy"
echo ""
echo "For local development:"
echo "  npx wrangler dev"
echo ""
