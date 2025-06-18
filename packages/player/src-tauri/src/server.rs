use std::{collections::HashSet, net::SocketAddr, sync::Arc, time::Duration};

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::RwLock as TokioRwLock;
use tokio::task::JoinHandle;

use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};

use futures::prelude::*;
use futures::stream::SplitSink;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::RwLock,
    task::JoinHandle,
};
use tracing::*;

type Connections = Arc<TokioRwLock<Vec<SplitSink<WebSocketStream<TcpStream>, Message>>>>;
type ConnectionAddrs = Arc<TokioRwLock<HashSet<SocketAddr>>>;

pub struct AMLLWebSocketServer {
    app: AppHandle,
    server_handle: Option<JoinHandle<()>>,
    connections: Connections,
    connection_addrs: ConnectionAddrs,
    async_runtime: tokio::runtime::Runtime,
}

impl AMLLWebSocketServer {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            server_handle: None,
            connections: Arc::new(TokioRwLock::new(Vec::with_capacity(8))),
            connection_addrs: Arc::new(TokioRwLock::new(HashSet::with_capacity(8))),
        }
    }

    pub async fn close(&mut self) {
        if let Some(task) = self.server_handle.take() {
            task.abort();
        }
        self.connections.write().await.clear();
        self.connection_addrs.write().await.clear();
        info!("WebSocket 服务器已关闭");
    }

    pub fn reopen(&mut self, addr: String, channel: Channel<ws_protocol::Body>) {
        if let Some(task) = self.server_handle.take() {
            task.abort();
        }
        if addr.is_empty() {
            info!("WebSocket 服务器已关闭");
            return;
        }
        let app = self.app.clone();
        let connections = self.connections.clone();
        let conn_addrs = self.connection_addrs.clone();
        
        self.server_handle = Some(tokio::spawn(async move {
            loop {
                info!("正在开启 WebSocket 服务器到 {addr}");
                match TcpListener::bind(&addr).await {
                    Ok(listener) => {
                        info!("已开启 WebSocket 服务器到 {addr}");
                        while let Ok((stream, _)) = listener.accept().await {
                            tokio::spawn(Self::accept_conn(
                                stream,
                                app.clone(),
                                connections.clone(),
                                conn_addrs.clone(),
                                channel.clone(),
                            ));
                        }
                        break;
                    }
                    Err(err) => {
                        error!("WebSocket 服务器 {addr} 开启失败: {err:?}");
                    }
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }));
    }

    pub async fn get_connections(&self) -> Vec<SocketAddr> {
        self.connection_addrs.read().await.iter().copied().collect()
    }

    pub async fn boardcast_message(&mut self, data: ws_protocol::Body) {
        let mut conns = self.connections.write().await;
        let mut i = 0;
        while i < conns.len() {
            if let Err(err) = conns[i]
                .send(Message::Binary(ws_protocol::to_body(&data).unwrap().into()))
                .await
            {
                warn!("WebSocket 客户端 {:?} 发送失败: {err:?}", conns[i]);
                let _ = conns.remove(i);
            } else {
                i += 1;
            }
        }
    }

    async fn accept_conn(
        stream: TcpStream,
        app: AppHandle,
        conns: Connections,
        conn_addrs: ConnectionAddrs,
        channel: Channel<ws_protocol::Body>,
    ) -> anyhow::Result<()> {
        let addr = stream.peer_addr()?;
        let addr_str = addr.to_string();
        info!("已接受套接字连接: {addr}");

        let wss = accept_async(stream).await?;
        
        info!("已连接 WebSocket 客户端: {addr}");
        app.emit("on-ws-protocol-client-connected", &addr_str)?;
        conn_addrs.write().await.insert(addr);

        let (write, mut read) = wss.split();

        conns.write().await.push(write);

        while let Some(Ok(data)) = read.next().await {
            if data.is_binary() {
                let data_vec = data.into_data();
                if let Ok(body) = ws_protocol::parse_body(&data_vec) {
                    if let Err(e) = channel.send(body) {
                        error!("向前端发送消息失败，可能前端已关闭。错误: {e:?}");
                        break;
                    }
                }
            }
        }

        info!("已断开 WebSocket 客户端: {addr}");
        app.emit("on-ws-protocol-client-disconnected", &addr_str)?;
        conn_addrs.write().await.remove(&addr);
        
        Ok(())
    }
}
