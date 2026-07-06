#!/bin/bash
# Fix SSH file permissions when bind-mounted from a Windows host.
# Windows NTFS does not support Unix permissions, so mounted files arrive as
# root:root 777. SSH refuses to use a config or key with world-writable perms.
chown -R node:node /home/node/.ssh
find /home/node/.ssh -type d -exec chmod 700 {} \;
find /home/node/.ssh -type f -exec chmod 600 {} \;
