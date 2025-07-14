# Hi, You may Splat TDOM
Using 3DGS methods to reconstruct TDOM can be a very useful alternaitive in relevant photogrammetric applications. Below is the experimental version of the code we utilized to splat TDOM using 3DGS. While it hasn’t been very elegant and meticulously organized yet, we are still more than happy to share it with you. If this resource proves helpful for graduate students and researchers working on similar projects, it would be great.

## Environmental Setups
The scene partitioning section of this code is based on the unofficial good implementation by KangPeiLun. If you're interested in vastGaussian, please click here:

https://github.com/kangpeilun/VastGaussian

If you're expecting the official implementation of vastGaussian, please wait a bit: 
https://github.com/VastGaussian/VastGaussian.github.io

## Data and Preparation
In data preparation step, we utilize the  `convert.py`  script to invoke COLMAP for structure-from-motion (SfM) reconstruction, producing a sparse 3D point cloud of the scene.
```
python convert.py -s {your_images_path} 
```
The NPU DroneMap dataset is created in:

S. Bu, Y. Zhao, G. Wan, and Z. Liu, "Map2DFusion: Real-time incremental UAV image mosaicing based on monocular SLAM," in 2016 IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS), Daejeon, Korea, 2016, pp. 4564-4571, doi: 10.1109/IROS.2016.7759672.

And can be sourced from the Ortho-NeRF paper:

Chen, S., et al., "Ortho-NeRF: generating a true digital orthophoto map using the neural radiance field from unmanned aerial vehicle images," Geo-spatial Information Science, vol. 1, no. 20, pp. 1–20, 2024, doi: 10.1080/10095020.2023.2296014.

Download here please: **[here](https://pan.baidu.com/s/1bW-4qtNzJzdQAo8QdOG-KA?pwd=vaxv)**
## Environments
>>>  💡
This code uses two separate environments: one for perspective optimization and another for orthographic splatting. The perspective and orthographic rasterizers are installed separately. While this separation helps with clarity and avoids confusion, it can be somewhat redundant. 
If you prefer to set up only a single environment to accomplish the same task, you can modify the rendering logic in the code using conditional statements.

We provide install method based on Conda package and environment management:

**First**, for an optimization environment with a perspective projection:
```
conda env create --file environment.yml
pip install submodules/diff-gaussian-rasterization
conda activate tortho_opti
```
CUDA 11.8  is  not strictly recommended.

**Second**, for a TDOM splatting (rendering):

Create a copy of the existing environment.
```
conda create --name tortho_splat --clone tortho_opti
conda activate tortho_splat
```
Install the orthographic rendering rasterize
```
pip install submodules/diff-gaussian-rasterization-ortho
```
The only difference between the two rasterizers lies in the Jacobian matrix within forward.cu. If you're interested in the projection process, that's the exact place to look.

## Do Training
COLMAP loaders expect the following dataset structure in the source path location.
```
 <folder_path> 
|---images
|   |---<image 0> 
|   |---<image 1> 
|   |---... 
|---sparse
    |---0 
        |---... 
```
To run the optimizer, simply use  the  `train_vast.py`  script in Tortho Gaussian. The execution command is placed in the `train_images.py`. Please first configure the alignment and any other parameters you want in the file according to the VastGaussian instructions. If you feel it a little puzzling,  please just use mine and easily try it out.
```
python train_images.py
```
or just run:
```
bash train_images.sh
```
Here is the full command:
```
python train_vast.py \
    -s <your_data_path> \
    --exp_name <your_experiment_name> \
    --eval \
    --llffhold 70 \
    --resolution 1 \
    --manhattan \
    --platform tj \
    --pos "0.000 0.000 0.000" \
    --rot "90.000 0.000 0.000" \
    --m_region 2 \
    --n_region 2 \
    --iterations 30000
```
## Do Rendering TDOM
To ortho-render Gaussian splats, please use script `final_splat.py` or `final_splat.sh`.
```
conda activate tortho_splat
```
run
```
python final_splat.py
```
or
```
bash final_splat.sh
```
Then you can find the output in the `custom_view` folder under your project directory.
> 💡 Tip:  
> In this codebase, training and rendering use **different environments**.
If you train with the orthographic rasterizer or render using the original rasterizer (or any other mismatch),
the result will be a complete mess of flickering artifacts — just be aware of this.

> If you encounter strange results, the first thing to check is whether you've switched to the correct environment.
# Final Splat Rendering Instructions

 Here is how to use the command-line options in `final_splat.sh` to control the rendering behavior, such as camera orientation, field of view, output resolution, and some more.

## 🔧 Command-Line Options

### 📐 Camera Rotation

Use the following options to fine-tune the virtual camera's rotation along the X, Y, and Z axes:

- `--angle_x`
- `--angle_y`
- `--angle_z`

> 💡 Tip:  
> If you can see the **side of a building**, the camera is likely not **perfectly perpendicular** to the ground.  
> For datasets that are not strictly top-down, you may need to adjust these angles carefully a bit.  
> Patience is required here for optimal results.

---

### 🌐 Field of View Control

To adjust how much of the scene is visible in the image, use either of the following:

- `--fov_deg`: Horizontal field of view in degrees.
- `--scale`: Scales the camera position outward to show more of the scene.

> ✅ You usually only need to adjust **one** of these parameters.

---

### 🖼️ Output Resolution

Use the following options to define the size (resolution) of the rendered image:

- `--width`: Image width in pixels.
- `--height`: Image height in pixels.

---

### 🎥 Camera Selection

To choose which camera pose to use:

- `--camera_idx`:
  - `-1`: Automatically selects the camera closest to the average position of all cameras.  
     *(Note: This may not always give ideal results.)*
  - Any other integer: Selects a specific camera by index from your dataset.

---

### 📦 Other Parameters

Other arguments follow the usage style and conventions from **VastGaussian**.

Here is the full command:

```
python ortho_splat.py \
  -s "./data/<your-data-path>/" \
  --exp_name "<your-experiment-name> " \
  --eval \
  --manhattan \
  --resolution 1 \
  --platform tj \
  --pos "0.000 0.000 0.000" \
  --rot "90.000 0.000 0.000" \
  --load_iteration 7000 \
  --angle_x 90 \
  --angle_y 0 \
  --angle_z 0 \
  --scale 0.2 \
  --fov_deg 200 \
  --width 3600 \
  --height 2000
  ```
Note that the *FAGK Gaussian kernel* is applied in the code. You can apply the same logic to other Gaussian-based methods, which might yield even better and better results.

###  📚 Citation
If you find this work helpful in your research or use our code/models, please consider citing our paper:
```
@misc{Tortho-Gaussian,
  title       = {Tortho-Gaussian: Splatting True Digital Orthophoto Maps},
  author      = {Xin Wang and Wendi Zhang and Hong Xie and Haibin Ai and Qiangqiang Yuan and Zongqian Zhan},
  year        = {2024},
  archivePrefix = {arXiv},
  eprint      = {2144.19594},
  primaryClass = {cs.CV}
}
```
