// Web shim for react-native-webview — renders an iframe
import React from 'react';

const WebView = React.forwardRef(({ source, style, onMessage, onLoad, onError, ...rest }, ref) => {
  const iframeRef = React.useRef(null);

  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (js) => {
      try {
        iframeRef.current?.contentWindow?.postMessage(js, '*');
      } catch (_) {}
    },
    reload: () => {
      try { iframeRef.current?.contentWindow?.location.reload(); } catch (_) {}
    },
  }));

  const src = source?.uri || (source?.html ? `data:text/html;charset=utf-8,${encodeURIComponent(source.html)}` : '');

  return React.createElement('iframe', {
    ref: iframeRef,
    src,
    style: {
      border: 'none',
      width: '100%',
      height: '100%',
      ...style,
    },
    onLoad,
    onError,
    title: 'webview',
    sandbox: 'allow-scripts allow-same-origin allow-popups',
  });
});

WebView.displayName = 'WebView';
export default WebView;
export { WebView };
