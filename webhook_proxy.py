# -*- coding: utf-8 -*-
"""
webhook_proxy.py
本地 CORS 代理：接收前端发来的企业微信消息，由 Python（服务器端，不受浏览器 CORS
限制）转发给企业微信 Webhook，再把结果原样返回给前端。

用法：
    python webhook_proxy.py
默认监听 http://localhost:8002/proxy

前端调用方式（notification.js 里 postToWebhook 的 url 改成本地代理地址）：
    fetch('http://localhost:8002/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '真正的企业微信 webhook 完整地址（含 key）',
        payload: { msgtype: 'text', text: { content: '...' } }
      })
    })
"""

import json
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8002


class ProxyHandler(BaseHTTPRequestHandler):

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        # 浏览器 CORS 预检请求
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != '/proxy':
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            raw_body = self.rfile.read(length)
            body = json.loads(raw_body.decode('utf-8'))

            target_url = body.get('target')
            payload = body.get('payload')

            if not target_url or payload is None:
                raise ValueError('请求体需要包含 target（webhook 地址）和 payload（消息内容）')

            req = urllib.request.Request(
                target_url,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )

            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_body = resp.read()
                self.send_response(200)
                self._send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(resp_body)

        except Exception as e:
            self.send_response(500)
            self._send_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))


if __name__ == '__main__':
    server = HTTPServer(('localhost', PORT), ProxyHandler)
    print('Webhook 代理已启动，监听 http://localhost:%d/proxy' % PORT)
    print('按 Ctrl+C 停止')
    server.serve_forever()
