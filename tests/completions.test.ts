import { describe, it, expect } from "vitest";
import { generateCompletions, type Shell } from "../src/completions.js";

describe("generateCompletions", () => {
  const subcommands = ["scan", "watch", "completions"];
  const formatValues = ["table", "json", "yaml"];
  const scannerNames = [
    "crontab",
    "systemd",
    "kubernetes",
    "eventbridge",
    "github-actions",
    "vercel",
    "cloudflare",
    "docker-cron",
  ];

  describe("bash", () => {
    const output = generateCompletions("bash");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains complete -F _schedex schedex", () => {
      expect(output).toContain("complete -F _schedex schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("zsh", () => {
    const output = generateCompletions("zsh");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains #compdef schedex", () => {
      expect(output).toContain("#compdef schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("fish", () => {
    const output = generateCompletions("fish");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains complete -c schedex", () => {
      expect(output).toContain("complete -c schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("invalid shell", () => {
    it("throws an error for unsupported shell", () => {
      expect(() => generateCompletions("powershell" as Shell)).toThrow(
        /Unsupported shell/
      );
    });

    it("throws for nushell", () => {
      expect(() => generateCompletions("nushell" as Shell)).toThrow(
        /Unsupported shell.*nushell/
      );
    });

    it("throws for tcsh", () => {
      expect(() => generateCompletions("tcsh" as Shell)).toThrow(
        /Unsupported shell.*tcsh/
      );
    });

    it("throws for empty string", () => {
      expect(() => generateCompletions("" as Shell)).toThrow(
        /Unsupported shell/
      );
    });
  });

  describe("bash — completeness", () => {
    const output = generateCompletions("bash");
    const allSubcommands = ["scan", "watch", "check", "export", "completions"];

    it("contains all subcommands including check and export", () => {
      for (const cmd of allSubcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("defines the _schedex function", () => {
      expect(output).toContain("_schedex()");
    });
  });

  describe("zsh — syntax validity", () => {
    const output = generateCompletions("zsh");

    it("starts with #compdef directive", () => {
      expect(output.trimStart().startsWith("#compdef schedex")).toBe(true);
    });

    it("ends with compdef _schedex schedex", () => {
      expect(output).toContain("compdef _schedex schedex");
    });

    it("contains _arguments calls", () => {
      expect(output).toContain("_arguments");
    });

    it("contains _describe for commands", () => {
      expect(output).toContain("_describe");
    });
  });

  describe("fish — syntax validity", () => {
    const output = generateCompletions("fish");

    it("starts with a comment", () => {
      expect(output.trimStart().startsWith("#")).toBe(true);
    });

    it("uses __fish_use_subcommand condition", () => {
      expect(output).toContain("__fish_use_subcommand");
    });

    it("uses __fish_seen_subcommand_from condition", () => {
      expect(output).toContain("__fish_seen_subcommand_from");
    });

    it("every complete line targets schedex", () => {
      const completeLines = output.split("\n").filter((l) => l.startsWith("complete"));
      expect(completeLines.length).toBeGreaterThan(0);
      for (const line of completeLines) {
        expect(line).toContain("-c schedex");
      }
    });
  });

  describe("output safety", () => {
    const shells: Shell[] = ["bash", "zsh", "fish"];

    for (const shell of shells) {
      it(`${shell} output does not contain backtick command substitution`, () => {
        const output = generateCompletions(shell);
        // Backticks in non-string contexts could be exploited
        // Only check that there are no unquoted backtick expressions
        // The output should not contain patterns like `rm -rf /` etc.
        expect(output).not.toMatch(/`[^`]*rm\s/);
        expect(output).not.toMatch(/`[^`]*curl\s/);
      });

      it(`${shell} output does not contain eval()`, () => {
        const output = generateCompletions(shell);
        expect(output).not.toContain("eval ");
      });
    }
  });
});
