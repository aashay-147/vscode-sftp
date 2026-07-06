FROM node:20

ARG TZ
ENV TZ="$TZ"

# Base developer tooling + firewall dependencies.
# This is a Node/TypeScript VS Code extension; it needs the JS toolchain (from
# the node:20 base) plus git/gh for source control and the iptables/ipset/dnsmasq
# stack that init-firewall.sh uses to lock egress. The document-generation and
# Postgres tooling from the inherited config is not needed here and was removed.
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  curl \
  wget \
  dnsmasq \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude /home/node/.local/bin && \
  chown -R node:node /workspace /home/node/.claude /home/node/.local

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin:/home/node/.local/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Powerlevel10k fast-prompt configuration. Ships the async/vcs overrides and
# wires instant-prompt into .zshrc so commands don't block on git status.
COPY --chown=node:node p10k.zsh /home/node/.p10k.zsh
RUN printf '%s\n' \
      '# Enable Powerlevel10k instant prompt. Keep near the top of .zshrc.' \
      'if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then' \
      '  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"' \
      'fi' \
      '' \
      > /tmp/p10k-head && \
    cat /tmp/p10k-head /home/node/.zshrc > /tmp/zshrc.new && \
    mv /tmp/zshrc.new /home/node/.zshrc && \
    rm /tmp/p10k-head && \
    printf '\n%s\n' '[[ -r ~/.p10k.zsh ]] && source ~/.p10k.zsh' >> /home/node/.zshrc

# Note: Claude Code is installed via postCreateCommand in devcontainer.json
# so it persists across container rebuilds.

# Copy and set up firewall + SSH permission scripts
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
COPY fix-ssh-permissions.sh /usr/local/bin/fix-ssh-permissions.sh
USER root
RUN sed -i 's/\r$//' /usr/local/bin/init-firewall.sh /usr/local/bin/fix-ssh-permissions.sh && \
  chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/fix-ssh-permissions.sh && \
  printf "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh\nnode ALL=(root) NOPASSWD: /usr/local/bin/fix-ssh-permissions.sh\n" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node
