import { describe, expect, it } from 'vitest';

import { InterventionChecker } from '../InterventionChecker';
import { DEFAULT_SECURITY_BLACKLIST } from '../defaultSecurityBlacklist';

describe('DEFAULT_SECURITY_BLACKLIST', () => {
  describe('File System Dangers', () => {
    describe('Recursive deletion of home directory', () => {
      it('should block rm -rf ~/', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~/',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Recursive deletion of home directory is extremely dangerous');
      });

      it('should block rm -rf ~ without trailing slash', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm -rf $HOME', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf $HOME',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm -rf /Users/username on macOS', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /Users/alice',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm -rf /home/username on Linux', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /home/alice',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm with different flag orders', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -r -f ~/',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow safe deletions in subdirectories', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~/Projects/temp',
        });
        expect(result.blocked).toBe(false);
      });

      it('should allow safe deletions in /home subdirectories', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /home/alice/temp-folder',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Recursive deletion of root directory', () => {
      it('should block rm -rf /', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Recursive deletion of root directory will destroy the system');
      });

      it('should block rm -r /', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -r /',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow safe deletions in specific directories', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /tmp/test-folder',
        });
        expect(result.blocked).toBe(false);
      });

      it('should allow safe deletions in /var/tmp', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /var/tmp/cache',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Force recursive deletion without specific target', () => {
      it('should block rm -rf . (current directory)', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf .',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm -rf ~', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block rm -rf /', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow rm -rf with specific target', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /tmp/specific-folder',
        });
        expect(result.blocked).toBe(false);
      });
    });
  });

  describe('System Configuration Dangers', () => {
    describe('Modifying /etc/passwd and /etc/shadow', () => {
      it('should block commands affecting /etc/passwd', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'echo "malicious" >> /etc/passwd',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Modifying /etc/passwd could lock you out of the system');
      });

      it('should block cat /etc/shadow', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /etc/shadow',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block editing /etc/passwd with vim', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim /etc/passwd',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow reading safe files in /etc', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /etc/hostname',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Modifying sudoers file', () => {
      it('should block editing /etc/sudoers', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'nano /etc/sudoers',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Modifying sudoers file without proper validation is dangerous');
      });

      it('should block cat /etc/sudoers', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /etc/sudoers',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block editing sudoers.d files', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim /etc/sudoers.d/custom',
        });
        expect(result.blocked).toBe(true);
      });
    });
  });

  describe('Dangerous Commands', () => {
    describe('Fork bomb', () => {
      it('should block classic fork bomb syntax', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: ':(){ :|:& };:',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Fork bomb can crash the system');
      });
    });

    describe('Writing to disk devices', () => {
      it('should block dd to /dev/sda', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/zero of=/dev/sda',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Writing random data to disk devices can destroy data');
      });

      it('should block dd to /dev/hda', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/urandom of=/dev/hda',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block dd to NVMe devices', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/zero of=/dev/nvme0n1',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow safe dd operations to files', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/zero of=/tmp/test.img bs=1M count=100',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Formatting system partitions', () => {
      it('should block mkfs on disk devices', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'mkfs.ext4 /dev/sda1',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Formatting system partitions will destroy data');
      });

      it('should block fdisk on disks', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'fdisk /dev/sda',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block parted on root', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'parted /',
        });
        expect(result.blocked).toBe(true);
      });
    });
  });

  describe('Network & Remote Access Dangers', () => {
    describe('Disabling firewall', () => {
      it('should block ufw disable', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'ufw disable',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Disabling firewall exposes system to attacks');
      });

      it('should block iptables -F', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'iptables -F',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block stopping firewalld', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'systemctl stop firewalld',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow checking firewall status', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'ufw status',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Changing SSH configuration', () => {
      it('should block editing sshd_config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'nano /etc/ssh/sshd_config',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Changing SSH configuration could lock you out');
      });

      it('should block cat /etc/ssh/sshd_config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /etc/ssh/sshd_config',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block vim on sshd_config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim /etc/ssh/sshd_config',
        });
        expect(result.blocked).toBe(true);
      });
    });
  });

  describe('Package Manager Dangers', () => {
    describe('Removing essential system packages', () => {
      it('should block apt remove systemd', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'apt remove systemd',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Removing essential system packages can break the system');
      });

      it('should block yum erase kernel', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'yum erase kernel',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block dnf remove glibc', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dnf remove glibc',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block apt purge bash', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'apt purge bash',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block pacman removing sudo', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'pacman remove sudo',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow removing safe packages', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'apt remove cowsay',
        });
        expect(result.blocked).toBe(false);
      });
    });
  });

  describe('Kernel & System Core Dangers', () => {
    describe('Modifying kernel parameters', () => {
      it('should block echo to /proc/sys/', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'echo 1>/proc/sys/kernel/panic',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe(
          'Modifying kernel parameters without understanding can crash the system',
        );
      });

      it('should block modifying network parameters', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'echo 0>/proc/sys/net/ipv4/ip_forward',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow reading /proc/sys/', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /proc/sys/kernel/hostname',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Direct memory access', () => {
      it('should block access to /dev/mem', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/mem of=/tmp/memory.dump',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Direct memory access is extremely dangerous');
      });

      it('should block access to /dev/kmem', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /dev/kmem',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block access to /dev/port', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'hexdump /dev/port',
        });
        expect(result.blocked).toBe(true);
      });
    });
  });

  describe('Privilege Escalation Dangers', () => {
    describe('Changing file ownership of system directories', () => {
      it('should block chown -R on /etc', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chown -R user:user /etc',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Changing file ownership of system directories is dangerous');
      });

      it('should block chown -R on /bin', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chown -R alice:alice /bin',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block chown -R on home directory', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chown -R root:root ~',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow chown on specific user files', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chown alice:alice /home/alice/file.txt',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Setting SUID on shells or interpreters', () => {
      it('should block chmod 4755 on bash', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chmod 4755 /bin/bash',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Setting SUID on shells or interpreters is a security risk');
      });

      it('should block chmod u+s on python', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chmod u+s /usr/bin/python',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block SUID on perl', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chmod 4755 /usr/bin/perl',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block SUID on node', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chmod u+s /usr/bin/node',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow normal chmod operations', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'chmod 755 /home/user/script.sh',
        });
        expect(result.blocked).toBe(false);
      });
    });
  });

  describe('Sensitive Information Leakage', () => {
    describe('Reading .env files', () => {
      it('should block cat .env via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat .env',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe(
          'Reading .env files may leak sensitive credentials and API keys',
        );
      });

      it('should block reading .env via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/project/.env',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block less .env.local', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'less .env.local',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block vim .env.production', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim .env.production',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block nano .env.development via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/project/.env.development',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading SSH private keys', () => {
      it('should block cat id_rsa via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/id_rsa',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Reading SSH private keys can compromise system security');
      });

      it('should block reading id_rsa via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.ssh/id_rsa',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block reading id_ed25519', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/id_ed25519',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block reading id_ecdsa via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/alice/.ssh/id_ecdsa',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow reading SSH public keys', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/id_rsa.pub',
        });
        expect(result.blocked).toBe(false);
      });

      it('should allow reading authorized_keys', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/authorized_keys',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Reading AWS credentials', () => {
      it('should block cat ~/.aws/credentials via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Accessing AWS credentials can leak cloud access keys');
      });

      it('should block reading AWS credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block less on AWS credentials', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'less /home/user/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow reading AWS config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.aws/config',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Reading Docker config', () => {
      it('should block reading Docker config.json via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.docker/config.json',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Reading Docker config may expose registry credentials');
      });

      it('should block reading Docker config via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.docker/config.json',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block vim on Docker config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim ~/.docker/config.json',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading Kubernetes config', () => {
      it('should block reading kube config via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.kube/config',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Reading Kubernetes config may expose cluster credentials');
      });

      it('should block reading kube config via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.kube/config',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block editing kube config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'nano ~/.kube/config',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading Git credentials', () => {
      it('should block reading git-credentials via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.git-credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Reading Git credentials file may leak access tokens');
      });

      it('should block reading git-credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.git-credentials',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block viewing git-credentials with less', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'less ~/.git-credentials',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading npm token file', () => {
      it('should block reading .npmrc via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.npmrc',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe(
          'Reading npm token file may expose package registry credentials',
        );
      });

      it('should block reading .npmrc via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.npmrc',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block editing .npmrc', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim /home/user/.npmrc',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading history files', () => {
      it('should block reading bash_history via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.bash_history',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe(
          'Reading history files may expose sensitive commands and credentials',
        );
      });

      it('should block reading bash_history via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.bash_history',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block reading zsh_history', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.zsh_history',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block reading .history via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.history',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Accessing browser credential storage', () => {
      it('should block reading browser Cookies file', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/Library/Application Support/Google/Chrome/Default/Cookies',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Accessing browser credential storage may leak passwords');
      });

      it('should block reading Login Data', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'less ~/.config/chromium/Default/Login Data',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block reading Web Data', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'head ~/.mozilla/firefox/profile/Web Data',
        });
        expect(result.blocked).toBe(true);
      });
    });

    describe('Reading GCP credentials', () => {
      it('should block reading GCP JSON credentials via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.config/gcloud/application_default_credentials.json',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('Reading GCP credentials may leak cloud service account keys');
      });

      it('should block reading GCP credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.config/gcloud/service-account.json',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block viewing GCP credentials with vim', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'vim ~/.config/gcloud/credentials.json',
        });
        expect(result.blocked).toBe(true);
      });

      it('should allow reading non-sensitive gcloud config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.config/gcloud/config.txt',
        });
        expect(result.blocked).toBe(false);
      });
    });
  });

  describe('Blacklist structure validation', () => {
    it('should have description for all rules', () => {
      DEFAULT_SECURITY_BLACKLIST.forEach((rule) => {
        expect(rule.description).toBeDefined();
        expect(rule.description.length).toBeGreaterThan(0);
      });
    });

    it('should have match conditions for all rules', () => {
      DEFAULT_SECURITY_BLACKLIST.forEach((rule) => {
        expect(rule.match).toBeDefined();
        expect(Object.keys(rule.match).length).toBeGreaterThan(0);
      });
    });

    it('should use regex type for pattern matching', () => {
      DEFAULT_SECURITY_BLACKLIST.forEach((rule) => {
        Object.values(rule.match).forEach((matcher) => {
          if (typeof matcher === 'object' && 'type' in matcher) {
            expect(matcher.type).toBe('regex');
          }
        });
      });
    });

    it('should have valid regex patterns', () => {
      DEFAULT_SECURITY_BLACKLIST.forEach((rule) => {
        Object.values(rule.match).forEach((matcher) => {
          if (typeof matcher === 'object' && 'pattern' in matcher) {
            expect(() => new RegExp(matcher.pattern)).not.toThrow();
          }
        });
      });
    });
  });

  describe('Edge cases and comprehensive coverage', () => {
    it('should handle multiple dangerous patterns in single command', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'cat .env && cat ~/.ssh/id_rsa',
      });
      expect(result.blocked).toBe(true);
    });

    it('should allow safe file operations', () => {
      const safeCommands = [
        'cat README.md',
        'less package.json',
        'vim src/index.ts',
        'rm -rf node_modules',
        'chmod +x script.sh',
        'chown user file.txt',
        'ls -la',
        'grep "pattern" file.txt',
      ];

      safeCommands.forEach((command) => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(false);
      });
    });

    it('should block operations across different editors', () => {
      const editors = ['cat', 'less', 'more', 'head', 'tail', 'vim', 'nano', 'vi', 'emacs', 'code'];

      editors.forEach((editor) => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: `${editor} .env`,
        });
        expect(result.blocked).toBe(true);
      });
    });

    it('should handle commands with various spacing and flags', () => {
      const variations = ['rm -rf ~/', 'rm  -rf  ~/', 'rm -r -f ~/', 'rm  -r  -f  ~/'];

      variations.forEach((command) => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
      });
    });
  });
});
