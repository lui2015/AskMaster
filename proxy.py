#!/usr/bin/env python3
# ============================================================
# AskMaster 极简本地代理 + 静态服务器（仅本机使用，零第三方依赖）
#
# 作用：解决浏览器直连大模型接口的 CORS 限制。
#   浏览器 --同源--> /proxy/chat --服务端转发--> 腾讯混元 TokenHub
#   API Key 仅存于本机 local-config.js（已被 .gitignore 忽略），
#   不进入浏览器、不提交仓库。
#
# 运行：python3 proxy.py   （默认端口 8770，可用 PORT 环境变量覆盖）
# ============================================================
import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os
import re

PORT = int(os.environ.get("PORT", "8770"))
ROUTE = os.environ.get("ROUTE", "/proxy/chat")
UPSTREAM = "https://tokenhub.tencentmaas.com/v1/chat/completions"


def load_key():
    """从 local-config.js 读取 API Key（与前端共用同一份本地配置）"""
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local-config.js")
        with open(path, "r", encoding="utf-8") as f:
            txt = f.read()
        m = re.search(r"apiKey:\s*['\"]([^'\"]+)['\"]", txt)
        if m:
            return m.group(1)
    except Exception:
        pass
    return os.environ.get("HUNYUAN_KEY", "")


KEY = load_key()


class Handler(http.server.SimpleHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def end_headers(self):
        # 静态资源也带 CORS，便于同源访问
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") == ROUTE.rstrip("/"):
            self._proxy_chat()
            return
        self.send_response(404)
        self.end_headers()

    def _proxy_chat(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        req = urllib.request.Request(
            UPSTREAM,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + KEY},
        )
        try:
            resp = urllib.request.urlopen(req, timeout=120)
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in ("transfer-encoding", "connection"):
                    continue
                self.send_header(k, v)
            self._cors()
            self.end_headers()
            # 流式透传：上游返回多少，就往浏览器写多少
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                try:
                    self.wfile.flush()
                except Exception:
                    break
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = json.dumps({"error": {"message": str(e)}}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(msg)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    # 仅监听回环地址：本地/线上均由本机（浏览器或 nginx）访问，不对外暴露端口
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("AskMaster 本地代理已启动: http://127.0.0.1:%d/  (Ctrl+C 退出)" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
