import { describe, expect, it } from 'vitest';

import { InterventionChecker } from '../InterventionChecker';
import { DEFAULT_SECURITY_BLACKLIST } from '../defaultSecurityBlacklist';

describe('DEFAULT_SECURITY_BLACKLIST', () => {
  describe('Structure and Completeness', () => {
    it('should export a non-empty array', () => {
      expect(Array.isArray(DEFAULT_SECURITY_BLACKLIST)).toBe(true);
      expect(DEFAULT_SECURITY_BLACKLIST.length).toBeGreaterThan(0);
    });

    it('should have valid structure for all rules', () => {
      for (const rule of DEFAULT_SECURITY_BLACKLIST) {
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(typeof rule.description).toBe('string');
        expect(rule.description.length).toBeGreaterThan(0);
        expect(typeof rule.match).toBe('object');
      }
    });

    it('should have descriptions for all rules', () => {
      // Note: Some descriptions are intentionally duplicated because
      // separate rules check the same security concern via different parameters
      // (e.g., one rule checks 'command', another checks 'path')
      const descriptions = DEFAULT_SECURITY_BLACKLIST.map((rule) => rule.description);
      const uniqueDescriptions = new Set(descriptions);

      // We expect some duplicates (command vs path checks)
      expect(descriptions.length).toBeGreaterThan(uniqueDescriptions.size);
      expect(uniqueDescriptions.size).toBeGreaterThan(15); // At least 15 unique security concerns
    });
  });

  describe('File System Dangers', () => {
    describe('Home Directory Deletion', () => {
      it('should block rm -rf with tilde', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~/',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('home directory');
      });

      it('should block rm -rf with $HOME variable', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf $HOME',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('home directory');
      });

      it('should block rm -rf on macOS home directories', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /Users/john',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('home directory');
      });

      it('should block rm -rf on Linux home directories', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /home/john',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('home directory');
      });

      it('should block rm -rf on multiple user homes', () => {
        const users = ['alice', 'bob', 'charlie', 'user123'];
        for (const user of users) {
          const linuxResult = InterventionChecker.checkSecurityBlacklist(
            DEFAULT_SECURITY_BLACKLIST,
            {
              command: `rm -rf /home/${user}`,
            },
          );
          expect(linuxResult.blocked).toBe(true);

          const macResult = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command: `rm -rf /Users/${user}`,
          });
          expect(macResult.blocked).toBe(true);
        }
      });

      it('should allow rm -rf on safe directories', () => {
        const safePaths = [
          'rm -rf /tmp/test',
          'rm -rf /var/tmp/build',
          'rm -rf ./node_modules',
          'rm -rf /opt/app/cache',
        ];

        for (const command of safePaths) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(false);
        }
      });
    });

    describe('Root Directory Deletion', () => {
      it('should block rm -rf /', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('root directory');
      });

      it('should block rm with -r flag on root', () => {
        // The blacklist regex specifically checks for -r flag pattern
        const commands = ['rm -rf /', 'rm -r /'];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
        }
      });
    });

    describe('Dangerous rm Patterns', () => {
      it('should block force recursive deletion of current directory', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf .',
        });
        expect(result.blocked).toBe(true);
      });

      it('should block force recursive deletion with tilde alone', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~',
        });
        expect(result.blocked).toBe(true);
      });
    });
  });

  describe('System Configuration Dangers', () => {
    describe('Password Files', () => {
      it('should block modification of /etc/passwd', () => {
        const commands = [
          'vim /etc/passwd',
          'nano /etc/passwd',
          'echo "test" >> /etc/passwd',
          'cat /etc/passwd > /tmp/backup',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('passwd');
        }
      });

      it('should block modification of /etc/shadow', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat /etc/shadow',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('passwd');
      });
    });

    describe('Sudoers File', () => {
      it('should block modification of sudoers file', () => {
        const commands = [
          'vim /etc/sudoers',
          'nano /etc/sudoers',
          'echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('sudoers');
        }
      });
    });
  });

  describe('Dangerous Commands', () => {
    describe('Fork Bomb', () => {
      it('should block fork bomb pattern', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: ':(){ :|:& };:',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Fork bomb');
      });
    });

    describe('Disk Device Operations', () => {
      it('should block dd to disk devices', () => {
        const commands = [
          'dd if=/dev/zero of=/dev/sda',
          'dd if=/dev/random of=/dev/hda',
          'dd if=/dev/urandom of=/dev/nvme0n1',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('disk devices');
        }
      });

      it('should allow dd to regular files', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/zero of=/tmp/test.img bs=1M count=100',
        });
        expect(result.blocked).toBe(false);
      });
    });

    describe('Partition Operations', () => {
      it('should block mkfs on disk devices', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'mkfs.ext4 /dev/sda1',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('partition');
      });

      it('should block fdisk operations', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'fdisk /dev/sda',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('partition');
      });

      it('should block parted operations', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'parted /dev/nvme0n1',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('partition');
      });
    });
  });

  describe('Network & Firewall Dangers', () => {
    it('should block ufw disable', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'ufw disable',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('firewall');
    });

    it('should block iptables flush', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'iptables -F',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('firewall');
    });

    it('should block stopping firewalld', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'systemctl stop firewalld',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('firewall');
    });

    it('should block SSH config modification', () => {
      const commands = ['vim /etc/ssh/sshd_config', 'nano /etc/ssh/sshd_config'];

      for (const command of commands) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('SSH');
      }
    });
  });

  describe('Package Manager Dangers', () => {
    it('should block removal of systemd', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'apt remove systemd',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('essential');
    });

    it('should block removal of kernel', () => {
      const commands = ['apt purge kernel', 'yum erase kernel', 'dnf remove kernel'];

      for (const command of commands) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('essential');
      }
    });

    it('should block removal of glibc', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'pacman remove glibc',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('essential');
    });

    it('should allow removal of normal packages', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'apt remove vim',
      });
      expect(result.blocked).toBe(false);
    });
  });

  describe('Kernel & System Core Dangers', () => {
    it('should block writing to /proc/sys', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'echo 1>/proc/sys/kernel/panic',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('kernel');
    });

    it('should block access to /dev/mem', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'cat /dev/mem',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('memory');
    });

    it('should block access to /dev/kmem', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'dd if=/dev/kmem of=/tmp/dump',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('memory');
    });

    it('should block access to /dev/port', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'xxd /dev/port',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('memory');
    });
  });

  describe('Privilege Escalation Dangers', () => {
    it('should block recursive chown on system directories', () => {
      const commands = [
        'chown -R user:user /etc',
        'chown -R user:user /bin',
        'chown -R user:user /sbin',
        'chown -R user:user /usr',
        'chown -R user:user /var',
        'chown -R user:user /sys',
        'chown -R user:user /proc',
      ];

      for (const command of commands) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('system directories');
      }
    });

    it('should block recursive chown on home directory', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'chown -R nobody:nobody ~',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('system directories');
    });

    it('should allow chown on project files', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'chown user:user /opt/myapp/file.txt',
      });
      expect(result.blocked).toBe(false);
    });

    it('should block SUID on shell executables', () => {
      const commands = [
        'chmod 4755 /bin/bash',
        'chmod u+s /bin/sh',
        'chmod 4755 /usr/bin/python',
        'chmod u+s /usr/bin/perl',
        'chmod 4755 /usr/bin/ruby',
        'chmod u+s /usr/bin/node',
      ];

      for (const command of commands) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('SUID');
      }
    });
  });

  describe('Sensitive Information Leakage', () => {
    describe('.env Files', () => {
      it('should block reading .env files via command', () => {
        const commands = [
          'cat .env',
          'cat .env.local',
          'cat .env.production',
          'less .env',
          'more .env.development',
          'head .env',
          'tail .env',
          'vim .env',
          'nano .env',
          'code .env',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('.env');
        }
      });

      it('should block reading .env files via path parameter', () => {
        const paths = [
          '/project/.env',
          '/app/.env.local',
          '/home/user/.env.production',
          '.env.development',
        ];

        for (const path of paths) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            path,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('.env');
        }
      });
    });

    describe('SSH Private Keys', () => {
      it('should block reading SSH private keys via command', () => {
        const commands = [
          'cat ~/.ssh/id_rsa',
          'cat ~/.ssh/id_ed25519',
          'cat ~/.ssh/id_ecdsa',
          'less /home/user/.ssh/id_rsa',
          'vim ~/.ssh/id_ed25519',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('SSH private keys');
        }
      });

      it('should block reading SSH private keys via path parameter', () => {
        const paths = [
          '/home/user/.ssh/id_rsa',
          '/home/user/.ssh/id_ed25519',
          '/home/user/.ssh/id_ecdsa',
        ];

        for (const path of paths) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            path,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('SSH private keys');
        }
      });

      it('should allow reading SSH public keys', () => {
        const commands = [
          'cat ~/.ssh/id_rsa.pub',
          'cat ~/.ssh/id_ed25519.pub',
          'cat ~/.ssh/id_ecdsa.pub',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(false);
        }
      });
    });

    describe('Cloud Credentials', () => {
      it('should block reading AWS credentials', () => {
        const commands = ['cat ~/.aws/credentials', 'less /home/user/.aws/credentials'];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('AWS');
        }
      });

      it('should block reading AWS credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('AWS');
      });

      it('should block reading GCP credentials', () => {
        const paths = [
          '/home/user/.config/gcloud/application_default_credentials.json',
          '/home/user/.config/gcloud/service_account.json',
        ];

        for (const path of paths) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            path,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('GCP');
        }
      });
    });

    describe('Container & Orchestration Credentials', () => {
      it('should block reading Docker config', () => {
        const command = 'cat ~/.docker/config.json';
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Docker');
      });

      it('should block reading Docker config via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.docker/config.json',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Docker');
      });

      it('should block reading Kubernetes config', () => {
        const command = 'cat ~/.kube/config';
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Kubernetes');
      });

      it('should block reading Kubernetes config via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.kube/config',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Kubernetes');
      });
    });

    describe('Git Credentials', () => {
      it('should block reading Git credentials file', () => {
        const commands = ['cat ~/.git-credentials', 'less /home/user/.git-credentials'];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('Git credentials');
        }
      });

      it('should block reading Git credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.git-credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Git credentials');
      });
    });

    describe('Package Manager Credentials', () => {
      it('should block reading npm token file', () => {
        const commands = ['cat ~/.npmrc', 'vim /home/user/.npmrc'];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('npm');
        }
      });

      it('should block reading npm token via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.npmrc',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('npm');
      });
    });

    describe('Shell History Files', () => {
      it('should block reading shell history files', () => {
        const commands = [
          'cat ~/.bash_history',
          'cat ~/.zsh_history',
          'cat ~/.history',
          'less /home/user/.bash_history',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('history');
        }
      });

      it('should block reading history files via path', () => {
        const paths = [
          '/home/user/.bash_history',
          '/home/user/.zsh_history',
          '/home/user/.history',
        ];

        for (const path of paths) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            path,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('history');
        }
      });
    });

    describe('Browser Credential Storage', () => {
      it('should block reading browser credential files', () => {
        const commands = [
          'cat ~/Library/Application Support/Google/Chrome/Default/Cookies',
          'cat ~/Library/Application Support/Google/Chrome/Default/Login Data',
          'cat ~/.config/google-chrome/Default/Web Data',
        ];

        for (const command of commands) {
          const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
            command,
          });
          expect(result.blocked).toBe(true);
          expect(result.reason).toContain('credential');
        }
      });
    });
  });

  describe('Real-world Attack Scenarios', () => {
    it('should block common attack vectors', () => {
      const attacks = [
        { command: 'rm -rf ~/', description: 'Home directory wipe' },
        { command: 'rm -rf /', description: 'Root wipe' },
        { command: ':(){ :|:& };:', description: 'Fork bomb' },
        { command: 'dd if=/dev/urandom of=/dev/sda', description: 'Disk corruption' },
        { command: 'cat ~/.ssh/id_rsa', description: 'Key exfiltration' },
        { command: 'cat .env', description: 'Secret exfiltration' },
        { command: 'chmod 4755 /bin/bash', description: 'SUID privilege escalation' },
        { command: 'echo 0>/proc/sys/kernel/randomize_va_space', description: 'ASLR disable' },
      ];

      for (const attack of attacks) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: attack.command,
        });
        expect(result.blocked).toBe(true);
      }
    });
  });

  describe('Safe Operations', () => {
    it('should allow legitimate operations', () => {
      const safeCommands = [
        'ls -la',
        'cat README.md',
        'git status',
        'npm install',
        'docker ps',
        'kubectl get pods',
        'vim main.ts',
        'rm -rf node_modules',
        'rm -rf dist',
        'chmod +x script.sh',
        'chown user:user file.txt',
        'cat ~/.ssh/id_rsa.pub',
        'echo "test" > /tmp/test.txt',
      ];

      for (const command of safeCommands) {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command,
        });
        expect(result.blocked).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tool args', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {});
      expect(result.blocked).toBe(false);
    });

    it('should handle undefined tool args', () => {
      const result = InterventionChecker.checkSecurityBlacklist(
        DEFAULT_SECURITY_BLACKLIST,
        undefined as any,
      );
      expect(result.blocked).toBe(false);
    });

    it('should handle commands with extra whitespace', () => {
      const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: '  rm -rf /  ',
      });
      expect(result.blocked).toBe(true);
    });

    it('should be case-sensitive for commands', () => {
      const lowerResult = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'rm -rf /',
      });
      expect(lowerResult.blocked).toBe(true);

      const upperResult = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
        command: 'RM -RF /',
      });
      expect(upperResult.blocked).toBe(false); // Case sensitive regex
    });
  });

  describe('Performance and Coverage', () => {
    it('should evaluate rules efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'ls -la',
        });
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete 1000 checks in < 1 second
    });

    it('should have comprehensive command pattern coverage', () => {
      // Count rules that check command parameter
      const commandRules = DEFAULT_SECURITY_BLACKLIST.filter(
        (rule) => rule.match?.command !== undefined,
      );
      expect(commandRules.length).toBeGreaterThan(20);
    });

    it('should have path-based protection rules', () => {
      // Count rules that check path parameter
      const pathRules = DEFAULT_SECURITY_BLACKLIST.filter((rule) => rule.match?.path !== undefined);
      expect(pathRules.length).toBeGreaterThan(5);
    });

    it('should cover multiple security categories', () => {
      const categories = {
        deletion: 0,
        firewall: 0,
        kernel: 0,
        package: 0,
        privilege: 0,
        sensitive: 0,
      };

      for (const rule of DEFAULT_SECURITY_BLACKLIST) {
        const desc = rule.description.toLowerCase();
        if (desc.includes('delet')) categories.deletion++;
        if (desc.includes('firewall')) categories.firewall++;
        if (desc.includes('kernel') || desc.includes('memory')) categories.kernel++;
        if (desc.includes('package') || desc.includes('essential')) categories.package++;
        if (desc.includes('suid') || desc.includes('privilege') || desc.includes('chown'))
          categories.privilege++;
        if (
          desc.includes('credentials') ||
          desc.includes('keys') ||
          desc.includes('leak') ||
          desc.includes('.env')
        )
          categories.sensitive++;
      }

      // Ensure we have rules in each major category
      expect(categories.deletion).toBeGreaterThan(0);
      expect(categories.firewall).toBeGreaterThan(0);
      expect(categories.kernel).toBeGreaterThan(0);
      expect(categories.privilege).toBeGreaterThan(0);
      expect(categories.sensitive).toBeGreaterThan(0);
    });
  });
});
