fn main() {
    std::process::exit(folio_lib::cli::main_entry(std::env::args_os().skip(1)));
}
