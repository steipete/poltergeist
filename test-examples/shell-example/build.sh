#!/bin/bash
echo "Building shell script project..."
echo "Timestamp: $(date)"
echo "Creating output..."
cat > output.txt << EOF
Build completed at $(date)
This is the built output from the shell example.
Random number: $RANDOM
EOF
echo "Build complete! Output written to output.txt"