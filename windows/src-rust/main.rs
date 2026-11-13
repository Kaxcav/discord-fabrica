use discord_fabrica::routes::{build_app, AppState};
use std::{env, net::SocketAddr};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let state = AppState::new();
    let app = build_app(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!(
        "[Selfbot Engine Rust v2] Servidor nativo rodando em http://0.0.0.0:{}",
        port
    );

    let listener = TcpListener::bind(addr)
        .await
        .expect("Falha ao abrir porta TCP");
    axum::serve(listener, app)
        .await
        .expect("Erro no servidor HTTP Axum");
}

