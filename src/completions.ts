export type Shell = "bash" | "zsh" | "fish";

const SUBCOMMANDS = ["scan", "watch", "check", "export", "completions"] as const;
const FORMAT_VALUES = ["table", "json", "yaml"] as const;
const SCANNER_NAMES = [
  "crontab",
  "systemd",
  "kubernetes",
  "eventbridge",
  "github-actions",
  "vercel",
  "cloudflare",
  "docker-cron",
] as const;
const SHELL_NAMES = ["bash", "zsh", "fish"] as const;

function generateBash(): string {
  return `_schedex() {
  local cur prev commands scan_opts watch_opts formats scanners shells
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${SUBCOMMANDS.join(" ")}"
  scan_opts="--format --scanners --verbose --config"
  watch_opts="--interval --format --scanners --verbose"
  check_opts="--scanners --verbose"
  export_opts="--scanners --verbose"
  formats="${FORMAT_VALUES.join(" ")}"
  scanners="${SCANNER_NAMES.join(" ")}"
  shells="${SHELL_NAMES.join(" ")}"

  # Determine the subcommand
  local subcmd=""
  for ((i=1; i < COMP_CWORD; i++)); do
    case "\${COMP_WORDS[i]}" in
      scan|watch|check|export|completions)
        subcmd="\${COMP_WORDS[i]}"
        break
        ;;
    esac
  done

  if [[ -z "$subcmd" ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "$prev" in
    --format|-f)
      COMPREPLY=( $(compgen -W "$formats" -- "$cur") )
      return 0
      ;;
    --scanners|-s)
      COMPREPLY=( $(compgen -W "$scanners" -- "$cur") )
      return 0
      ;;
  esac

  case "$subcmd" in
    scan)
      COMPREPLY=( $(compgen -W "$scan_opts" -- "$cur") )
      ;;
    watch)
      COMPREPLY=( $(compgen -W "$watch_opts" -- "$cur") )
      ;;
    check)
      COMPREPLY=( $(compgen -W "$check_opts" -- "$cur") )
      ;;
    export)
      COMPREPLY=( $(compgen -W "$export_opts" -- "$cur") )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "$shells" -- "$cur") )
      ;;
  esac

  return 0
}
complete -F _schedex schedex
`;
}

function generateZsh(): string {
  return `#compdef schedex

_schedex() {
  local -a commands formats scanners shells
  commands=(
    'scan:Scan infrastructure for scheduled jobs'
    'watch:Poll and report changes'
    'check:Run health checks on discovered schedules'
    'export:Export metrics in Prometheus format'
    'completions:Generate shell completions'
  )
  formats=(table json yaml)
  scanners=(${SCANNER_NAMES.join(" ")})
  shells=(bash zsh fish)

  _arguments '1:command:->command' '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        scan)
          _arguments \\
            '(-f --format)'{-f,--format}'[Output format]:format:(table json yaml)' \\
            '(-s --scanners)'{-s,--scanners}'[Scanners to run]:scanner:($scanners)' \\
            '(-v --verbose)'{-v,--verbose}'[Show scanner timing and error details]' \\
            '(-c --config)'{-c,--config}'[Path to config file]:file:_files'
          ;;
        watch)
          _arguments \\
            '(-i --interval)'{-i,--interval}'[Polling interval]:interval:' \\
            '(-f --format)'{-f,--format}'[Output format]:format:(table json yaml)' \\
            '(-s --scanners)'{-s,--scanners}'[Scanners to run]:scanner:($scanners)' \\
            '(-v --verbose)'{-v,--verbose}'[Show timing and unchanged scans]'
          ;;
        check)
          _arguments \\
            '(-s --scanners)'{-s,--scanners}'[Scanners to run]:scanner:($scanners)' \\
            '(-v --verbose)'{-v,--verbose}'[Show scanner timing and error details]'
          ;;
        export)
          _arguments \\
            '(-s --scanners)'{-s,--scanners}'[Scanners to run]:scanner:($scanners)' \\
            '(-v --verbose)'{-v,--verbose}'[Show scanner timing and error details]'
          ;;
        completions)
          _arguments '1:shell:(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

compdef _schedex schedex
`;
}

function generateFish(): string {
  const lines: string[] = [
    "# Disable file completions by default",
    "complete -c schedex -f",
    "",
    "# Subcommands",
    `complete -c schedex -n '__fish_use_subcommand' -a 'scan' -d 'Scan infrastructure for scheduled jobs'`,
    `complete -c schedex -n '__fish_use_subcommand' -a 'watch' -d 'Poll and report changes'`,
    `complete -c schedex -n '__fish_use_subcommand' -a 'check' -d 'Run health checks on discovered schedules'`,
    `complete -c schedex -n '__fish_use_subcommand' -a 'export' -d 'Export metrics in Prometheus format'`,
    `complete -c schedex -n '__fish_use_subcommand' -a 'completions' -d 'Generate shell completions'`,
    "",
    "# scan options",
    `complete -c schedex -n '__fish_seen_subcommand_from scan' -s f -l format -d 'Output format' -xa '${FORMAT_VALUES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from scan' -s s -l scanners -d 'Scanners to run' -xa '${SCANNER_NAMES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from scan' -s v -l verbose -d 'Show scanner timing and error details'`,
    `complete -c schedex -n '__fish_seen_subcommand_from scan' -s c -l config -d 'Path to config file' -rF`,
    "",
    "# watch options",
    `complete -c schedex -n '__fish_seen_subcommand_from watch' -s i -l interval -d 'Polling interval'`,
    `complete -c schedex -n '__fish_seen_subcommand_from watch' -s f -l format -d 'Output format' -xa '${FORMAT_VALUES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from watch' -s s -l scanners -d 'Scanners to run' -xa '${SCANNER_NAMES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from watch' -s v -l verbose -d 'Show timing and unchanged scans'`,
    "",
    "# check options",
    `complete -c schedex -n '__fish_seen_subcommand_from check' -s s -l scanners -d 'Scanners to run' -xa '${SCANNER_NAMES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from check' -s v -l verbose -d 'Show scanner timing and error details'`,
    "",
    "# export options",
    `complete -c schedex -n '__fish_seen_subcommand_from export' -s s -l scanners -d 'Scanners to run' -xa '${SCANNER_NAMES.join(" ")}'`,
    `complete -c schedex -n '__fish_seen_subcommand_from export' -s v -l verbose -d 'Show scanner timing and error details'`,
    "",
    "# completions argument",
    `complete -c schedex -n '__fish_seen_subcommand_from completions' -xa '${SHELL_NAMES.join(" ")}'`,
    "",
  ];
  return lines.join("\n");
}

export function generateCompletions(shell: Shell): string {
  switch (shell) {
    case "bash":
      return generateBash();
    case "zsh":
      return generateZsh();
    case "fish":
      return generateFish();
    default:
      throw new Error(
        `Unsupported shell: ${shell as string}. Supported shells: bash, zsh, fish`,
      );
  }
}
