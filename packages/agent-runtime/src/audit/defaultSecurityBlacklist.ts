import { type SecurityBlacklistConfig } from '@lobechat/types';

/**
 * Default Security Blacklist
 * These rules will ALWAYS block execution and require human intervention,
 * regardless of user settings (even in auto-run mode)
 *
 * This is the last line of defense against dangerous operations
 *
 * Note: `description` values are i18n keys (namespace: 'tool', prefix: 'securityBlacklist.')
 * and are translated in the intervention UI via `t(description)`.
 */
export const DEFAULT_SECURITY_BLACKLIST: SecurityBlacklistConfig = [
  // ==================== File System Dangers ====================
  {
    description: 'securityBlacklist.rmHomeDir',
    match: {
      command: {
        pattern: 'rm.*-r.*(~|\\$HOME|/Users/[^/]+|/home/[^/]+)/?\\s*$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.rmRootDir',
    match: {
      command: {
        pattern: 'rm.*-r.*/\\s*$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.rmForceRecursive',
    match: {
      command: {
        pattern: 'rm\\s+-rf\\s+[~./]\\s*$',
        type: 'regex',
      },
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
  },
  {
    description: 'securityBlacklist.sshConfig',
    match: {
      command: {
        pattern: '.*(/etc/ssh/sshd_config).*',
        type: 'regex',
      },
    },
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
  },
  {
    description: 'securityBlacklist.envFiles',
    match: {
      path: {
        pattern: '.*\\.env.*',
        type: 'regex',
      },
    },
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
  },
  {
    description: 'securityBlacklist.sshPrivateKeys',
    match: {
      path: {
        pattern: '.*/\\.ssh/(id_rsa|id_ed25519|id_ecdsa)$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.awsCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.aws/credentials.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.awsCredentials',
    match: {
      path: {
        pattern: '.*/\\.aws/credentials.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.dockerConfig',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.docker/config\\.json.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.dockerConfig',
    match: {
      path: {
        pattern: '.*/\\.docker/config\\.json$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.kubeConfig',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.kube/config.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.kubeConfig',
    match: {
      path: {
        pattern: '.*/\\.kube/config$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.gitCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.git-credentials.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.gitCredentials',
    match: {
      path: {
        pattern: '.*/\\.git-credentials$',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.npmrc',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.npmrc.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.npmrc',
    match: {
      path: {
        pattern: '.*/\\.npmrc$',
        type: 'regex',
      },
    },
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
  },
  {
    description: 'securityBlacklist.historyFiles',
    match: {
      path: {
        pattern: '.*/\\.(bash_history|zsh_history|history)$',
        type: 'regex',
      },
    },
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
  },
  {
    description: 'securityBlacklist.gcpCredentials',
    match: {
      command: {
        pattern: '(cat|less|more|head|tail|vim|nano|vi|emacs|code).*/\\.config/gcloud/.*\\.json.*',
        type: 'regex',
      },
    },
  },
  {
    description: 'securityBlacklist.gcpCredentials',
    match: {
      path: {
        pattern: '.*/\\.config/gcloud/.*\\.json$',
        type: 'regex',
      },
    },
  },
];
