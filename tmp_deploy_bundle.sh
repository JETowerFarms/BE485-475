#!/bin/bash
set -e
BUNDLE=bundle.8a2d611657bb50334410.js
WEB=/var/www/besolarfarms

# Remove old bundle(s)
sudo rm -f $WEB/bundle.*.js $WEB/dist/bundle.*.js

# Install new bundle in both root and dist/
sudo cp /tmp/$BUNDLE $WEB/$BUNDLE
sudo cp /tmp/$BUNDLE $WEB/dist/$BUNDLE
sudo chown root:root $WEB/$BUNDLE $WEB/dist/$BUNDLE

# Rewrite bundle reference in both index.html files
sudo sed -i "s/bundle\.[0-9a-f]*\.js/$BUNDLE/g" $WEB/index.html
sudo sed -i "s/bundle\.[0-9a-f]*\.js/$BUNDLE/g" $WEB/dist/index.html

# Verify
echo "=== Verification ==="
ls -la $WEB/$BUNDLE $WEB/dist/$BUNDLE
grep -o 'bundle\.[0-9a-f]*\.js' $WEB/index.html $WEB/dist/index.html
echo "DEPLOY_OK"
