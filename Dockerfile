# ১. বর্তমানে সাপোর্টেড Node.js LTS (Long Term Support) Alpine ইমেজ ব্যবহার করা হয়েছে
FROM node:22-alpine

# ২. শুরুতেই NODE_ENV সেট করা, যেন কিছু প্যাকেজ প্রোডাকশন মোডে অপ্টিমাইজডভাবে ইনস্টল হয়
ENV NODE_ENV=production

# ৩. অ্যাপ ডিরেক্টরি তৈরি এবং পারমিশন সেট করা (Non-root ইউজারের জন্য)
WORKDIR /app
RUN chown node:node /app

# ৪. রুট (root) ইউজার থেকে 'node' ইউজারে সুইচ করা (Security-র জন্য অত্যন্ত গুরুত্বপূর্ণ)
USER node

# ৫. ডিপেন্ডেন্সি ক্যাশিং অপ্টিমাইজ করার জন্য শুধুমাত্র package ফাইলগুলো আগে কপি করা
COPY --chown=node:node package*.json ./

# ৬. দ্রুত এবং পারফেক্ট ইনস্টলের জন্য npm ci ব্যবহার (dev dependencies বাদ দিয়ে)
RUN npm install --omit=dev

# ৭. বাকি সোর্স কোড কপি করা
COPY --chown=node:node . .

# ৮. পোর্ট এক্সপোজ করা (Render এর জন্য অপশনাল হলেও স্ট্যান্ডার্ড প্র্যাকটিস)
EXPOSE 5000

# ৯. লাইটওয়েট Healthcheck (Render নিজে থেকে চেক করে, তবে লোকাল/Docker Swarm এর জন্য এটি উপকারী)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# ১০. অ্যাপ স্টার্ট করা
CMD ["npm", "start"]
