#!/bin/bash
unset OPENROUTER_API_KEY

# Try to run mountz if it's available (ignore errors if not)
if command -v mountz &> /dev/null; then
    echo "Running mountz..."
    mountz
elif [ -f ~/.bashrc ] && grep -q "alias mountz" ~/.bashrc; then
    echo "Loading aliases and running mountz..."
    source ~/.bashrc && mountz
else
    echo "mountz command not found, skipping..."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Check if mount point is accessible
echo "Checking mount point /mnt/z..."
if [ -d "/mnt/z" ]; then
    echo "Mount point /mnt/z exists"
    ls -la /mnt/z
else
    echo "WARNING: Mount point /mnt/z does not exist or is not accessible"
fi

# Run the server
echo "Starting server..."
node server.js /mnt/z
