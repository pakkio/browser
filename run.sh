#!/bin/bash

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