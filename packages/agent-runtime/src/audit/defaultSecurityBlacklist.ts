import { type SecurityBlacklistConfig } from '@lobechat/types';

/**
 * Default Security Blacklist
 *
 * These rules block execution and require human intervention by default.
 * Rules explicitly marked as 'required' can be bypassed by auto-run flows.
 *
 * Note: `description` values are i18n keys (namespace: 'tool', prefix: 'securityBlacklist.')
 * and are translated in the intervention UI via `t(description)`.
 */
export const DEFAULT_SECURITY_BLACKLIST: SecurityBlacklistConfig = [
  // ==================== File System Dangers ====================
  //
  // rm rules use `semanticShell` predicates evaluated against the PARSED
  // command (segmented on ; | && with quote awareness, wrappers like
  // sudo/env/nohup unwrapped, targets classified) instead of raw-string
  // regex. Regex forms like `rm.*-r.*/\s*$` catastrophically false-positive:
  // `ls .../terminal-bench-regex-log/` matched because "term**rm**inal"
  // supplied `rm`, "-**r**egex" supplied `-r`, and the trailing `/` supplied
  // the root target — three harmless fragments spanning unrelated commands.
  //
  // The semantic predicates require: the resolved command IS `rm`, a
  // recursive flag is active, AND a target actually resolves to '/' or a
  // home directory. Note quoting cannot hide danger (`rm '-rf' /` is still
  // caught) because the shell strips quotes before argv.
  {
    description: 'securityBlacklist.rmHomeDir',
    match: {
      command: { type: 'semanticShell', predicate: 'rmRecursiveHomeTarget' },
    },
  },
  {
    description: 'securityBlacklist.rmRootDir',
    match: {
      command: { type: 'semanticShell', predicate: 'rmRecursiveRootTarget' },
    },
  },
  {
    description: 'securityBlacklist.rmForceRecursive',
    match: {
      command: { type: 'semanticShell', predicate: 'rmForceDotTarget' },
    },
  },

  // ==================== System Configuration Dangers ====================
  {
    description: 'securityBlacklist.etcPasswd',
    match: {
      command: {
        pattern: '.*(/etc/passwd|/etc/shadow).*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.sudoers',
    match: {
      command: {
        pattern: '.*/etc/sudoers.*',
        type: 'regex',
      },
    },
  },

  // ==================== Dangerous Commands ====================
  {
    description: 'securityBlacklist.forkBomb',
    match: {
      command: {
        pattern: '.*:\\(\\).*\\{.*\\|.*&.*\\};.*:.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.ddDiskWrite',
    match: {
      command: {
        pattern: 'dd.*of=/dev/(sd|hd|nvme).*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.formatPartition',
    match: {
      command: {
        pattern: '(mkfs|fdisk|parted).*(/dev/(sd|hd|nvme)|/)',
        type: 'regex',
      },
    },
  },

  // ==================== Network & Remote Access Dangers ====================
  {
    description: 'securityBlacklist.disableFirewall',
    match: {
      command: {
        pattern: '(ufw\\s+disable|iptables\\s+-F|systemctl\\s+stop\\s+firewalld)',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.sshConfig',
    match: {
      command: {
        pattern: '.*(/etc/ssh/sshd_config).*',
        type: 'regex',
      },
    },
    policy: 'required',
  },

  // ==================== Package Manager Dangers ====================
  {
    description: 'securityBlacklist.removeSystemPackages',
    match: {
      command: {
        pattern: '(apt|yum|dnf|pacman)\\s+(remove|purge|erase).*(systemd|kernel|glibc|bash|sudo)',
        type: 'regex',
      },
    },
    policy: 'required',
  },

  // ==================== Kernel & System Core Dangers ====================
  {
    description: 'securityBlacklist.kernelParams',
    match: {
      command: {
        pattern: 'echo.*>/proc/sys/.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.directMemoryAccess',
    match: {
      command: {
        pattern: '.*(/dev/(mem|kmem|port)).*',
        type: 'regex',
      },
    },
  },

  // ==================== Privilege Escalation Dangers ====================
  {
    description: 'securityBlacklist.chownSystemDirs',
    match: {
      command: {
        pattern: 'chown.*-R.*(/(etc|bin|sbin|usr|var|sys|proc)|~).*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.suidShells',
    match: {
      command: {
        pattern: 'chmod.*(4755|u\\+s).*(sh|bash|python|perl|ruby|node)',
        type: 'regex',
      },
    },
  },

  // ==================== Sensitive Information Leakage ====================
  {
    description: 'securityBlacklist.envFiles',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*\\.env.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.envFiles',
    match: {
      path: {
        pattern: '.*\\.env.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.sshPrivateKeys',
    match: {
      command: {
        pattern:
          '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*(id_rsa|id_ed25519|id_ecdsa)(?!\\.pub).*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.sshPrivateKeys',
    match: {
      path: {
        pattern: '.*/\\.ssh/(id_rsa|id_ed25519|id_ecdsa)$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.awsCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.aws/credentials.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.awsCredentials',
    match: {
      path: {
        pattern: '.*/\\.aws/credentials.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.dockerConfig',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.docker/config\\.json.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.dockerConfig',
    match: {
      path: {
        pattern: '.*/\\.docker/config\\.json$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.kubeConfig',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.kube/config.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.kubeConfig',
    match: {
      path: {
        pattern: '.*/\\.kube/config$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.gitCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.git-credentials.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.gitCredentials',
    match: {
      path: {
        pattern: '.*/\\.git-credentials$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.npmrc',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.npmrc.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.npmrc',
    match: {
      path: {
        pattern: '.*/\\.npmrc$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.historyFiles',
    match: {
      command: {
        pattern:
          '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.(bash_history|zsh_history|history).*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.historyFiles',
    match: {
      path: {
        pattern: '.*/\\.(bash_history|zsh_history|history)$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.browserCredentials',
    match: {
      command: {
        pattern:
          '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*(Cookies|Login Data|Web Data).*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.gcpCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.config/gcloud/.*\\.json.*',
        type: 'regex',
      },
    },
    policy: 'required',
  },
  {
    description: 'securityBlacklist.gcpCredentials',
    match: {
      path: {
        pattern: '.*/\\.config/gcloud/.*\\.json$',
        type: 'regex',
      },
    },
    policy: 'required',
  },
];
