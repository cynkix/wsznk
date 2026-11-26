FROM nginx:alpine
RUN printf 'server {\n listen 8080;\n root /usr/share/nginx/html;\n index index.html;\n location / { try_files $uri $uri/ =404; }\n}\n' > /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
