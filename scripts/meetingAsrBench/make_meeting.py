import json, subprocess, os, soundfile as sf, numpy as np
D=os.path.join(os.environ.get('ASR_BENCH_DIR', os.path.expanduser('~/asr-bench')), 'data'); os.makedirs(D, exist_ok=True)
turns=[
("nova","大家好，我们开始今天的周会。这周主要 review 一下 Q4 的 roadmap 和 meeting notes 功能的进度。"),
("onyx","好的。我先同步一下，ASR 的 streaming 接口已经接上了，但是现在有六十秒的限制，长会议会断。"),
("nova","这个问题比较关键。飞书妙记可以录两个小时，我们至少要支持一个小时以上的会议。"),
("onyx","我的想法是前端每五十秒自动切一个 session，后端用 WebSocket 续接，同时把原始音频存到 S3，录完之后再跑一遍 batch transcription。"),
("echo","我补充一下，desktop 端可以用本地的 SenseVoice 或者 Whisper 模型，音频不出本机，对隐私敏感的客户很重要。"),
("nova","那性能怎么样？在 MacBook 上能不能做到实时？"),
("echo","我测过 sherpa-onnx，SenseVoice small 的 RTF 大概零点零几，一个小时的会议一两分钟就能转完。"),
("onyx","说话人分离可以用 pyannote 或者 3D-Speaker，sherpa-onnx 里面也有 diarization 的 pipeline。"),
("nova","好。纪要部分，我希望录完以后自动生成 summary、key decisions 和 action items。"),
("onyx","Action items 可以直接转成 LobeHub 的 task，assignee 根据说话人和上下文来推断，用户确认后再创建。"),
("nova","决定一下：第一期先做录音浮层、实时逐字稿和录后精转，分享和评论放到第二期。"),
("echo","没问题。那 action item：我负责本地模型的 benchmark，周五之前出报告。"),
("onyx","我负责长会话的切片方案和音频存储，下周三之前提 PR。"),
("nova","我来写 PRD，并且和设计同学对一下浮层的交互。今天就到这里，谢谢大家。"),
]
sr=16000; gap=np.zeros(int(0.7*sr),dtype=np.float32); pcm=[]; segs=[]; t=0.0
for i,(v,txt) in enumerate(turns):
    a=f'{D}/o{i}.mp3'; w=f'{D}/o{i}.wav'
    os.path.exists(a) or subprocess.run(['lh','generate','tts','-o',a,'--voice',v,txt],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',a,'-ar','16000','-ac','1',w],check=True)
    x,_=sf.read(w,dtype='float32'); d=len(x)/sr
    segs.append({'speaker':v,'start':round(t,2),'end':round(t+d,2),'text':txt})
    pcm+= [x,gap]; t+=d+0.7
y=np.concatenate(pcm); sf.write(f'{D}/meeting.wav',y,sr)
json.dump(segs,open(f'{D}/meeting_ref.json','w'),ensure_ascii=False,indent=1)
# long version: 6x loop for RTF/memory on long audio
sf.write(f'{D}/meeting_long.wav',np.tile(y,6),sr)
print('dur',round(len(y)/sr,1),'long',round(6*len(y)/sr,1))
