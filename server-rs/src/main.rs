//! `filebrowser`: the File Browser server, for a terminal. See `fbcore::server::HELP`.

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{}", fbcore::server::HELP);
        return;
    }
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("filebrowser {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    fbcore::server::run_cli(args).await;
}
