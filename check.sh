#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "Checking for LaTeX compiler..."
if command -v pdflatex &> /dev/null; then
    echo "pdflatex found: $(which pdflatex)"
    pdflatex --version | head -1
else
    echo "pdflatex NOT found."
    echo ""
    echo "To install, run:"
    echo "  sudo apt-get install texlive-latex-extra texlive-fonts-recommended"
fi
