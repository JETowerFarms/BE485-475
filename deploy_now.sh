#!/bin/bash
set -e
BUNDLE=bundle.96b0bedf6e99e978f69b.js
WEB=/var/www/besolarfarms

sudo rm -f $WEB/bundle.*.js $WEB/dist/bundle.*.js
sudo mv /tmp/$BUNDLE $WEB/$BUNDLE
sudo cp $WEB/$BUNDLE $WEB/dist/$BUNDLE
sudo sed -i "s/bundle\.[0-9a-f]*\.js/$BUNDLE/g" $WEB/index.html
sudo sed -i "s/bundle\.[0-9a-f]*\.js/$BUNDLE/g" $WEB/dist/index.html

sudo cp /tmp/reportsHandler.js /home/money/backend/src/routes/reportsHandler.js
sudo chown money:money /home/money/backend/src/routes/reportsHandler.js

sudo -u money pm2 restart solar-api

echo "DEPLOY_OK"
